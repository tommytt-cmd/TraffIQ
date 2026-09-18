from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Callable

import websockets
from websockets import WebSocketClientProtocol
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from web3 import Web3
# no direct eth_abi usage required; Web3 contract `processLog` is used for decoding

from app.repositories.stock_repository import StockRepository

logger = logging.getLogger("stock_vault")

STOCK_VAULT_ABI = [
    {"type": "event", "name": "StockReceived", "anonymous": False, "inputs": [{"indexed": True, "name": "roundId", "type": "uint256"}, {"indexed": True, "name": "stockToken", "type": "address"}, {"indexed": False, "name": "amount", "type": "uint256"}]},
    {"type": "event", "name": "RoundFinalized", "anonymous": False, "inputs": [{"indexed": True, "name": "roundId", "type": "uint256"}]},
    {"type": "event", "name": "WinnerClaimed", "anonymous": False, "inputs": [{"indexed": True, "name": "roundId", "type": "uint256"}, {"indexed": True, "name": "winner", "type": "address"}, {"indexed": True, "name": "stockToken", "type": "address"}, {"indexed": False, "name": "amount", "type": "uint256"}]},
    {"type": "function", "name": "getRoundInfo", "stateMutability": "view", "inputs": [{"type": "uint256"}], "outputs": [{"type": "bool"}, {"type": "bool"}, {"type": "uint256"}, {"type": "uint256"}]},
    {"type": "function", "name": "getWinnerAt", "stateMutability": "view", "inputs": [{"type": "uint256"}, {"type": "uint256"}], "outputs": [{"type": "address"}]},
    {"type": "function", "name": "getWinnerContribution", "stateMutability": "view", "inputs": [{"type": "uint256"}, {"type": "address"}], "outputs": [{"type": "uint256"}]},
    {"type": "function", "name": "calculateEntitlement", "stateMutability": "view", "inputs": [{"type": "uint256"}, {"type": "address"}, {"type": "address"}], "outputs": [{"type": "uint256"}, {"type": "uint256"}, {"type": "uint256"}]},
]
ERC20_ABI = [{"type": "function", "name": "symbol", "stateMutability": "view", "inputs": [], "outputs": [{"type": "string"}]}, {"type": "function", "name": "decimals", "stateMutability": "view", "inputs": [], "outputs": [{"type": "uint8"}]}]


class StockVaultIndexer:
    """WebSocket-based StockVault event listener.

    This class subscribes to contract logs over a `wss://` provider using
    `eth_subscribe` and decodes events with the contract ABI, then delegates
    processing to the existing business logic methods (`_handle_event`,
    `_sync_round`, `_token_metadata`).
    """

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        rpc_url: str,
        vault_address: str,
        ws_headers: dict[str, str] | None = None,
    ) -> None:
        self.session_factory = session_factory
        self.rpc_url = rpc_url
        self.vault_address = Web3.to_checksum_address(vault_address)
        # websocket URL should be wss:// or ws://
        self.w3_ws: Web3 | None = None
        self.w3_http: Web3 | None = None
        # create a sync contract factory using HTTP for any single-shot recovery calls
        try:
            self.w3_http = Web3(Web3.HTTPProvider(rpc_url))
        except Exception:
            self.w3_http = None
        # contract event helpers (instantiate lazily when provider available)
        self._contract = None
        self._event_sig_map: dict[str, Any] = {}
        self._stop_event = asyncio.Event()
        self.last_processed_block: int | None = None
        self._ws: WebSocketClientProtocol | None = None
        self._ws_headers = ws_headers or None

    # -------------------------- preserved business logic ---------------------
    async def _handle_event(self, repository: StockRepository, event: object) -> None:  # type: ignore[override]
        # preserved: caller uses repository and event object as before
        name = event["event"]
        args = event["args"]
        round_number = int(args["roundId"])
        round_model = await repository.get_round_by_number(round_number)
        if round_model is None:
            return
        if name == "StockReceived":
            address = str(args["stockToken"]).lower()
            token = await repository.get_or_create_token(address, *await asyncio.to_thread(self._token_metadata, address))
            await repository.upsert_round_stock(round_model.id, token.id, int(args["amount"]), event["transactionHash"].hex())
        elif name == "WinnerClaimed":
            winner = str(args["winner"]).lower()
            address = str(args["stockToken"]).lower()
            player = await repository.get_player(winner)
            token = await repository.get_token(address)
            if token is None:
                token = await repository.get_or_create_token(address, *await asyncio.to_thread(self._token_metadata, address))
            if player is not None:
                await repository.record_claim(
                    round_id=round_model.id,
                    player_id=player.id,
                    token_id=token.id,
                    amount=int(args["amount"]),
                    tx_hash=event["transactionHash"].hex(),
                )
        await self._sync_round(repository, round_model, round_number)

    async def _sync_round(self, repository: StockRepository, round_model: object, round_number: int) -> None:  # type: ignore[override]
        # preserved
        created, finalized, total, winner_count = await asyncio.to_thread(self._contract.functions.getRoundInfo(round_number).call)
        if not created:
            return
        stocks = await repository.stocks_for_round(round_model.id)
        for index in range(int(winner_count)):
            winner = str(await asyncio.to_thread(self._contract.functions.getWinnerAt(round_number, index).call)).lower()
            player = await repository.get_player(winner)
            if player is None:
                continue
            contribution = int(await asyncio.to_thread(self._contract.functions.getWinnerContribution(round_number, winner).call))
            for _, token in stocks:
                entitled, claimed, _ = await asyncio.to_thread(self._contract.functions.calculateEntitlement(round_number, token.token_address, winner).call)
                await repository.upsert_reward(round_id=round_model.id, player_id=player.id, token_id=token.id, contribution=contribution, total_contribution=int(total), entitlement=int(entitled), claimed=int(claimed))

    def _token_metadata(self, address: str) -> tuple[str, int]:  # type: ignore[override]
        contract = self.w3_http.eth.contract(address=Web3.to_checksum_address(address), abi=ERC20_ABI) if self.w3_http is not None else None
        try:
            if contract is None:
                raise RuntimeError("HTTP provider not available for token metadata")
            return str(contract.functions.symbol().call()), int(contract.functions.decimals().call())
        except Exception:
            return address[:10], 18

    # -------------------------- new listener logic ---------------------------
    async def _ensure_contract(self) -> None:
        if self._contract is None:
            # lazily create websocket-backed Web3 and contract helper
            try:
                self.w3_ws = Web3(Web3.WebsocketProvider(self.rpc_url))
            except Exception:
                self.w3_ws = None
            # prefer websocket contract when available for thread-wrapped calls
            w3_for_contract = self.w3_ws if self.w3_ws is not None else self.w3_http
            if w3_for_contract is None:
                raise RuntimeError("No usable web3 provider available")
            self._contract = w3_for_contract.eth.contract(address=self.vault_address, abi=STOCK_VAULT_ABI)
            # prepare event signature map
            for item in STOCK_VAULT_ABI:
                if item.get("type") == "event":
                    sig = f"{item['name']}({','.join([i['type'] for i in item['inputs']])})"
                    sig_hash = Web3.keccak(text=sig).hex()
                    self._event_sig_map[sig_hash] = item["name"]

    async def listen_forever(self) -> None:
        """Connect to the RPC websocket provider and subscribe to contract logs.

        On disconnect, perform recovery (single eth_getLogs from last_processed_block+1 to latest)
        and then reconnect and resubscribe. Runs until `stop()` is called.
        """
        await self._ensure_contract()
        backoff = 1
        while not self._stop_event.is_set():
            try:
                logger.info("ws_connect_attempt", extra={"url": self.rpc_url})
                # pass headers if provided (convert dict to list of tuples)
                extra_headers = None
                if self._ws_headers:
                    extra_headers = [(k, v) for k, v in self._ws_headers.items()]
                connected_with_headers = False
                # Try connecting with headers first (if provided), fall back if underlying library
                # doesn't accept the extra_headers argument.
                if extra_headers is not None:
                    try:
                        async with websockets.connect(self.rpc_url, extra_headers=extra_headers) as ws:
                            self._ws = ws
                            logger.info("ws_connected")
                            print(f"stock-vault: ws connected to {self.rpc_url}")

                            # subscribe to logs for this contract and our event topics
                            event_sigs = list(self._event_sig_map.keys())
                            # put all event sigs in the first topic slot (OR)
                            topics = [event_sigs]
                            req = {
                                "jsonrpc": "2.0",
                                "id": 1,
                                "method": "eth_subscribe",
                                "params": ["logs", {"address": self.vault_address, "topics": topics}],
                            }
                            await ws.send(json.dumps(req))
                            resp = json.loads(await ws.recv())
                            print(f"stock-vault: subscribe response: {resp}")
                            sub_id = resp.get("result")
                            if sub_id is None:
                                logger.warning("ws_subscribe_no_result", extra={"resp": resp})
                                print("stock-vault: warning - subscribe returned no subscription id")
                            logger.info("ws_subscribed", extra={"subscription": sub_id})
                            print(f"stock-vault: subscribed (id={sub_id}) to {self.vault_address}")

                            # if reconnect recovery needed, fetch missed logs once
                            if self.last_processed_block is not None:
                                print(f"stock-vault: recovering missed logs from {self.last_processed_block + 1}")
                                await self._recover_missed_logs()
                                print("stock-vault: recovery complete")

                            # consume messages
                            while not self._stop_event.is_set():
                                try:
                                    msg = await asyncio.wait_for(ws.recv(), timeout=60)
                                except asyncio.TimeoutError:
                                    # keepalive: ping the server
                                    try:
                                        await ws.send(json.dumps({"jsonrpc": "2.0", "id": 0, "method": "web3_clientVersion"}))
                                        _ = await asyncio.wait_for(ws.recv(), timeout=10)
                                        continue
                                    except Exception:
                                        raise
                                data = json.loads(msg)
                                # subscription notification format: {"jsonrpc":"2.0","method":"eth_subscription","params":{"result":{...},"subscription":"..."}}
                                params = data.get("params")
                                if not params:
                                    continue
                                result = params.get("result")
                                if not result:
                                    continue
                                # decode log
                                decoded = await asyncio.to_thread(self._decode_log, result)
                                if decoded is None:
                                    logger.warning("unknown_event_received", extra={"log": result})
                                    print(f"stock-vault: unknown event for log {result.get('logIndex')} in block {result.get('blockNumber')}")
                                    continue
                                # process decoded event in DB context
                                try:
                                    async with self.session_factory() as session:
                                        repository = StockRepository(session)
                                        await self._handle_event(repository, decoded)
                                    # update last_processed_block
                                    blk = result.get("blockNumber")
                                    if isinstance(blk, str) and blk.startswith("0x"):
                                        self.last_processed_block = int(blk, 16)
                                    elif isinstance(blk, int):
                                        self.last_processed_block = int(blk)
                                    logger.info("event_processed", extra={"event": decoded.get("event"), "block": self.last_processed_block})
                                    print(f"stock-vault: event={decoded.get('event')} block={self.last_processed_block}")
                                except Exception:
                                    logger.exception("event_processing_failed", extra={"event": decoded})
                                    print(f"stock-vault: failed processing event {decoded.get('event')}")

                            # exit inner context cleanly
                            logger.info("ws_unsubscribing", extra={"subscription": sub_id})
                            try:
                                await ws.send(json.dumps({"jsonrpc": "2.0", "id": 2, "method": "eth_unsubscribe", "params": [sub_id]}))
                            except Exception:
                                pass
                        connected_with_headers = True
                    except TypeError as exc:
                        # Some websocket implementations (or mismatched packages) raise
                        # a TypeError when they don't accept extra_headers; fall back.
                        if "extra_headers" in str(exc) or "create_connection" in str(exc):
                            print("stock-vault: websockets.connect doesn't accept extra_headers; retrying without headers")
                        else:
                            raise

                if not connected_with_headers:
                    async with websockets.connect(self.rpc_url) as ws:
                        self._ws = ws
                        logger.info("ws_connected")
                        print(f"stock-vault: ws connected to {self.rpc_url}")

                        # subscribe to logs for this contract and our event topics
                        event_sigs = list(self._event_sig_map.keys())
                        # put all event sigs in the first topic slot (OR)
                        topics = [event_sigs]
                        req = {
                            "jsonrpc": "2.0",
                            "id": 1,
                            "method": "eth_subscribe",
                            "params": ["logs", {"address": self.vault_address, "topics": topics}],
                        }
                        await ws.send(json.dumps(req))
                        resp = json.loads(await ws.recv())
                        sub_id = resp.get("result")
                        logger.info("ws_subscribed", extra={"subscription": sub_id})
                        print(f"stock-vault: subscribed (id={sub_id}) to {self.vault_address}")

                        # if reconnect recovery needed, fetch missed logs once
                        if self.last_processed_block is not None:
                            print(f"stock-vault: recovering missed logs from {self.last_processed_block + 1}")
                            await self._recover_missed_logs()
                            print("stock-vault: recovery complete")

                        # consume messages
                        while not self._stop_event.is_set():
                            try:
                                msg = await asyncio.wait_for(ws.recv(), timeout=60)
                            except asyncio.TimeoutError:
                                # keepalive: ping the server
                                try:
                                    await ws.send(json.dumps({"jsonrpc": "2.0", "id": 0, "method": "web3_clientVersion"}))
                                    _ = await asyncio.wait_for(ws.recv(), timeout=10)
                                    continue
                                except Exception:
                                    raise
                            data = json.loads(msg)
                            # subscription notification format: {"jsonrpc":"2.0","method":"eth_subscription","params":{"result":{...},"subscription":"..."}}
                            params = data.get("params")
                            if not params:
                                continue
                            result = params.get("result")
                            if not result:
                                continue
                            # decode log
                            decoded = await asyncio.to_thread(self._decode_log, result)
                            if decoded is None:
                                logger.warning("unknown_event_received", extra={"log": result})
                                print(f"stock-vault: unknown event for log {result.get('logIndex')} in block {result.get('blockNumber')}")
                                continue
                            # process decoded event in DB context
                            try:
                                async with self.session_factory() as session:
                                    repository = StockRepository(session)
                                    await self._handle_event(repository, decoded)
                                # update last_processed_block
                                blk = result.get("blockNumber")
                                if isinstance(blk, str) and blk.startswith("0x"):
                                    self.last_processed_block = int(blk, 16)
                                elif isinstance(blk, int):
                                    self.last_processed_block = int(blk)
                                logger.info("event_processed", extra={"event": decoded.get("event"), "block": self.last_processed_block})
                                print(f"stock-vault: event={decoded.get('event')} block={self.last_processed_block}")
                            except Exception:
                                logger.exception("event_processing_failed", extra={"event": decoded})
                                print(f"stock-vault: failed processing event {decoded.get('event')}")

                        # exit inner context cleanly
                        logger.info("ws_unsubscribing", extra={"subscription": sub_id})
                        try:
                            await ws.send(json.dumps({"jsonrpc": "2.0", "id": 2, "method": "eth_unsubscribe", "params": [sub_id]}))
                        except Exception:
                            pass
            except Exception as exc:
                logger.exception("ws_connection_error", exc_info=exc)
                print(f"stock-vault: ws connection error: {exc}; reconnecting in 5s")
                # wait before reconnect
                await asyncio.sleep(5)
                backoff = min(backoff * 2, 60)
                continue
        logger.info("ws_listener_stopped")

    async def stop(self) -> None:
        self._stop_event.set()
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass

    def _decode_log(self, raw_log: dict[str, Any]) -> dict[str, Any] | None:
        """Attempt to decode a raw log using the contract ABI event definitions.

        Returns a dict like the events returned by `get_logs()` so existing
        handlers can operate unchanged.
        """
        # Raw topics: list of hex strings
        topics = raw_log.get("topics") or []
        if len(topics) == 0:
            return None
        topic0 = topics[0]
        if topic0 is None:
            return None
        # find event name
        event_name = self._event_sig_map.get(topic0)
        if event_name is None:
            return None
        # use web3 contract's event processing if available
        try:
            ev = None
            if self._contract is not None:
                # build a log in the format web3 expects
                ev = self._contract.events[event_name]().processLog(raw_log)
                # processLog returns an AttributeDict-like object
                return {
                    "event": ev.event,
                    "args": dict(ev.args),
                    "transactionHash": ev.transactionHash,
                    "blockNumber": ev.blockNumber,
                    "logIndex": ev.logIndex,
                }
        except Exception:
            logger.exception("event_decode_failed", extra={"raw": raw_log})
            return None

    async def _recover_missed_logs(self) -> None:
        """On reconnect, fetch a single bounded range of logs from last_processed_block+1 to latest.

        This performs a single `eth_getLogs` call (wrapped in a thread) and
        processes returned logs, then resumes subscriptions.
        """
        if self.last_processed_block is None:
            return
        if self.w3_http is None:
            logger.warning("http_provider_unavailable_for_recovery")
            return
        try:
            latest = await asyncio.to_thread(lambda: self.w3_http.eth.block_number)
            if latest <= self.last_processed_block:
                return
            logger.info("recovering_missed_logs", extra={"from": self.last_processed_block + 1, "to": latest})
            # perform a single bounded get_logs call
            filter_params = {"fromBlock": self.last_processed_block + 1, "toBlock": latest, "address": self.vault_address}
            raw_logs = await asyncio.to_thread(lambda: self.w3_http.eth.get_logs(filter_params))
            # process logs in order
            for raw in sorted(raw_logs, key=lambda item: (item.get("blockNumber", 0), item.get("logIndex", 0))):
                decoded = await asyncio.to_thread(self._decode_log, raw)
                if decoded is None:
                    continue
                try:
                    async with self.session_factory() as session:
                        repository = StockRepository(session)
                        await self._handle_event(repository, decoded)
                    blk = raw.get("blockNumber")
                    if isinstance(blk, str) and blk.startswith("0x"):
                        self.last_processed_block = int(blk, 16)
                    elif isinstance(blk, int):
                        self.last_processed_block = int(blk)
                    logger.info("recovered_event_processed", extra={"event": decoded.get("event"), "block": self.last_processed_block})
                except Exception:
                    logger.exception("recovered_event_processing_failed", extra={"raw": raw})
        except Exception:
            logger.exception("recovery_failed")
