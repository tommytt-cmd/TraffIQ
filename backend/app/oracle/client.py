from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from eth_account import Account
from web3 import Web3
from web3.exceptions import (
    ContractLogicError,
    ContractCustomError,
    TransactionNotFound,
    Web3RPCError,
    BadFunctionCallOutput,
)

BACKEND_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_ROOT.parent


class OracleConnectionError(Exception):
    pass


class OracleClient:
    @staticmethod
    def _resolve_contract_json_path(configured_path: str | Path) -> Path:
        candidate = Path(configured_path).expanduser()
        roots = [
            BACKEND_ROOT,
            PROJECT_ROOT,
            BACKEND_ROOT.parent,
            PROJECT_ROOT.parent,
            Path.cwd(),
        ]

        if candidate.is_absolute():
            paths = [candidate]
        else:
            paths = [
                candidate,
                *[root / candidate for root in roots],
            ]

        basename = candidate.name
        if basename:
            for root in roots:
                paths.extend(
                    [
                        root / "contract" / "out" / basename,
                        root / "out" / basename,
                        *list(root.glob(f"**/{basename}")),
                        *list((root / "contract").glob(f"**/{basename}")),
                    ]
                )

        unique_paths: list[Path] = []
        seen: set[Path] = set()
        for path in paths:
            resolved = path.resolve(strict=False)
            if resolved not in seen:
                unique_paths.append(resolved)
                seen.add(resolved)

        for path in unique_paths:
            if path.exists():
                return path

        return unique_paths[0] if unique_paths else candidate

    def __init__(
        self,
        rpc_url: str,
        contract_address: str,
        contract_json_path: str | None = None,
        private_key: str | None = None,
    ) -> None:
        self.rpc_url = rpc_url
        self.contract_address = Web3.to_checksum_address(contract_address)
        if contract_json_path:
            self.contract_json_path = self._resolve_contract_json_path(contract_json_path)
        else:
            self.contract_json_path = self._resolve_contract_json_path(
                BACKEND_ROOT / "app" / "oracle" / "artifacts" / "TraffiqBetting.json"
            )
        self.private_key = private_key
        self.account = None
        if self.private_key:
            private_key = self.private_key
            if not private_key.startswith("0x"):
                private_key = "0x" + private_key
            try:
                self.account = Account.from_key(private_key)
            except Exception as exc:
                raise OracleConnectionError("Invalid oracle private key") from exc

        self.web3 = Web3(Web3.HTTPProvider(self.rpc_url))
        if self.account is not None:
            self.web3.eth.default_account = self.account.address
        self.contract = self._load_contract()

    def _load_contract(self) -> Any:
        if not self.contract_json_path.exists():
            raise OracleConnectionError(f"Contract JSON file not found: {self.contract_json_path}")

        with self.contract_json_path.open("r", encoding="utf-8") as handle:
            contract_data = json.load(handle)

        abi = contract_data.get("abi")
        if not isinstance(abi, list):
            raise OracleConnectionError("Contract ABI not found in JSON file")

        self.abi = abi
        return self.web3.eth.contract(address=self.contract_address, abi=abi)

    def validate_required_functions(self, required_functions: set[str]) -> None:
        """Fail startup when the configured artifact cannot drive the round lifecycle."""
        available = {
            item.get("name")
            for item in self.abi
            if item.get("type") == "function" and isinstance(item.get("name"), str)
        }
        missing = sorted(required_functions - available)
        if missing:
            raise OracleConnectionError(
                "Configured RushBetting ABI is incompatible; missing functions: "
                + ", ".join(missing)
            )

    def supports_function(self, function_name: str) -> bool:
        return any(
            item.get("type") == "function" and item.get("name") == function_name
            for item in self.abi
        )

    def is_connected(self) -> bool:
        return self.web3.is_connected()

    def get_latest_block(self) -> int:
        try:
            return self.web3.eth.block_number
        except Exception as exc:
            raise OracleConnectionError("Unable to retrieve latest block") from exc

    def get_chain_id(self) -> int:
        if not self.is_connected():
            raise OracleConnectionError("RPC provider is not connected")
        try:
            return int(self.web3.eth.chain_id)
        except Exception as exc:
            raise OracleConnectionError("Unable to retrieve RPC chain ID") from exc

    def call_readonly(self, function_name: str, *args: Any) -> Any:
        if not self.is_connected():
            raise OracleConnectionError("RPC provider is not connected")
        try:
            contract_fn = getattr(self.contract.functions, function_name)
            return contract_fn(*args).call()
        except ContractLogicError as exc:
            raise OracleConnectionError(f"Contract read-only call failed: {exc}") from exc
        except BadFunctionCallOutput as exc:
            # Attempt a low-level eth_call to capture raw return bytes for debugging
            try:
                data = self.contract.encodeABI(fn_name=function_name, args=list(args))
                raw = self.web3.eth.call({"to": self.contract_address, "data": data})
            except Exception:
                raise OracleConnectionError(
                    f"BadFunctionCallOutput while calling {function_name}; ABI may not match on-chain contract"
                ) from exc

            # Try to decode the raw return using the ABI from the artifact
            try:
                # load ABI fragment for function
                contract_json = json.loads(self.contract_json_path.read_text(encoding="utf-8"))
                fn_abi = None
                for item in contract_json.get("abi", []):
                    if item.get("type") == "function" and item.get("name") == function_name:
                        fn_abi = item
                        break

                if fn_abi is None:
                    raise OracleConnectionError(
                        f"BadFunctionCallOutput: function ABI for {function_name} not found; raw_return={raw.hex()}"
                    )

                outputs = fn_abi.get("outputs", [])
                # handle single tuple (struct) outputs by building a tuple type string
                if len(outputs) == 1 and outputs[0].get("type") == "tuple":
                    comp_types = [c["type"] for c in outputs[0].get("components", [])]
                    tuple_type = f"({','.join(comp_types)})"
                    output_types = [tuple_type]
                else:
                    output_types = [o.get("type") for o in outputs]

                decoded = self.web3.codec.decode(output_types, raw)
                # If a single tuple, return its first element for compatibility
                if len(decoded) == 1:
                    return decoded[0]
                return decoded
            except OracleConnectionError:
                raise
            except Exception:
                raise OracleConnectionError(
                    f"BadFunctionCallOutput while decoding {function_name}; raw_return={raw.hex()}"
                ) from exc
        except AttributeError as exc:
            raise OracleConnectionError(f"Contract function not found: {function_name}") from exc

    def round_exists(self, round_number: int) -> bool:
        for function_name in ("getRound", "getRoundInfo"):
            try:
                data = self.call_readonly(function_name, round_number)
                if data is None:
                    continue

                def has_meaningful_value(v: object) -> bool:
                    if v is None:
                        return False
                    if isinstance(v, (bytes, bytearray)):
                        return any(b != 0 for b in v)
                    if isinstance(v, (list, tuple)):
                        return any(has_meaningful_value(x) for x in v)
                    # Treat empty strings and falsy numeric/boolean as not meaningful
                    if v in (0, 0.0, False, ""):
                        return False
                    return True

                # If the call returned a mapping/struct, inspect values
                try:
                    items = getattr(data, 'items', None)
                    if callable(items):
                        for _, val in data.items():
                            if has_meaningful_value(val):
                                return True
                        continue
                except Exception:
                    pass

                # If the call returned a tuple/list, inspect elements
                if isinstance(data, (list, tuple)):
                    for val in data:
                        if has_meaningful_value(val):
                            return True
                    continue

                # Fallback: any truthy scalar counts as existence
                if has_meaningful_value(data):
                    return True
            except OracleConnectionError:
                continue
        return False

    def get_balance(self, address: str | None = None) -> int:
        if not self.is_connected():
            raise OracleConnectionError("RPC provider is not connected")
        if address is None:
            if self.account is None:
                raise OracleConnectionError("Oracle account is not configured")
            address = self.account.address
        try:
            return self.web3.eth.get_balance(Web3.to_checksum_address(address))
        except Exception as exc:
            raise OracleConnectionError("Unable to retrieve oracle account balance") from exc

    def get_onchain_oracle(self) -> str:
        errors: list[str] = []
        for function_name in ("oracle", "resultOracle"):
            if not self.supports_function(function_name):
                errors.append(f"{function_name}: not present in ABI")
                continue
            try:
                return self.call_readonly(function_name)
            except OracleConnectionError as exc:
                errors.append(f"{function_name}: call failed: {exc}")
                continue

        details = "; ".join(errors) if errors else "no matching getter found in ABI"
        raise OracleConnectionError(
            f"Contract at {self.contract_address} does not expose a working oracle getter on RPC {self.rpc_url}. "
            f"Details: {details}"
        )

    def send_transaction(
        self,
        function_name: str,
        *args: Any,
        value: int = 0,
        gas: int | None = None,
    ) -> str:
        if not self.is_connected():
            raise OracleConnectionError("RPC provider is not connected")
        if self.account is None:
            raise OracleConnectionError("Oracle private key is required for transactional calls")
        try:
            contract_fn = getattr(self.contract.functions, function_name)(*args)
        except AttributeError as exc:
            raise OracleConnectionError(f"Contract function not found: {function_name}") from exc

        transaction = {
            "chainId": self.web3.eth.chain_id,
            "nonce": self.web3.eth.get_transaction_count(self.account.address),
            "from": self.account.address,
            "value": value,
        }

        if gas is not None:
            transaction["gas"] = gas

        # Attempt to build the transaction. If the node rejects the build
        # due to EIP-1559 baseFee vs provided fee fields, retry by adding
        # `maxPriorityFeePerGas`/`maxFeePerGas` computed from the latest
        # block and the node's suggested priority fee.
        try:
            tx = contract_fn.build_transaction(transaction)
            if gas is None and tx.get("gas") is None:
                tx["gas"] = self.web3.eth.estimate_gas(tx)
        except ContractCustomError as exc:
            # Decode the 4-byte revert selector and map it to known custom errors
            try:
                selector = None
                if isinstance(exc.args, tuple) and len(exc.args) >= 1:
                    selector = exc.args[0]
                if isinstance(selector, (bytes, bytearray)):
                    selector_hex = self.web3.to_hex(selector[:4])
                else:
                    selector_hex = str(selector)

                # Known custom errors declared in RushBetting.sol
                known_errors = [
                    "ZeroAddress",
                    "InvalidRound",
                    "InvalidAmount",
                    "InvalidThreshold",
                    "InvalidBetSide",
                    "InvalidFeeBps",
                    "BettingWindowClosed",
                    "NotOracle",
                    "NotHouseBot",
                    "HouseBetAlreadyPlaced",
                    "HouseBetNotAllowed",
                    "RoundAlreadySettled",
                    "RoundNotSettled",
                    "NoWinningStake",
                    "AlreadyClaimed",
                    "InsufficientFunds",
                    "NothingToClaim",
                ]
                selector_map: dict[str, str] = {}
                for name in known_errors:
                    try:
                        s = self.web3.keccak(text=f"{name}()")[:4]
                        selector_map[self.web3.to_hex(s)] = name
                    except Exception:
                        continue

                if selector_hex in selector_map:
                    raise OracleConnectionError(
                        f"Contract rejected call with custom error: {selector_map[selector_hex]} ({selector_hex})"
                    ) from exc
                raise OracleConnectionError(f"Contract rejected call with selector {selector_hex}") from exc
            except OracleConnectionError:
                raise
            except Exception:
                raise OracleConnectionError(f"Contract transaction failed during build/estimate: {exc}") from exc
        except (ContractLogicError, Web3RPCError) as exc:
            # Try an EIP-1559 fallback: compute sensible maxFee/maxPriority
            try:
                base_fee = 0
                latest = self.web3.eth.get_block("latest")
                base_fee = int(latest.get("baseFee", 0) or 0)
                max_priority = int(self.web3.eth.max_priority_fee)
                # Ensure maxFee is safely above base fee (20% headroom)
                max_fee = max_priority + max(int(base_fee * 1.2), base_fee + 1)
                transaction.update({
                    "maxPriorityFeePerGas": max_priority,
                    "maxFeePerGas": max_fee,
                })
                tx = contract_fn.build_transaction(transaction)
                if gas is None and tx.get("gas") is None:
                    tx["gas"] = self.web3.eth.estimate_gas(tx)
            except Exception:
                raise OracleConnectionError(
                    f"Contract transaction failed during build/estimate: {exc}"
                ) from exc

        balance = self.get_balance(self.account.address)
        # Compute required gas payment. Support legacy 'gasPrice' and EIP-1559 fields.
        gas_price = None
        if "gasPrice" in tx:
            gas_price = int(tx["gasPrice"])
        elif "maxFeePerGas" in tx:
            gas_price = int(tx["maxFeePerGas"])
        else:
            # As a fallback, query a suggested gas price
            try:
                gas_price = int(self.web3.eth.gas_price)
            except Exception:
                gas_price = 0

        required = value + int(tx["gas"]) * int(gas_price)
        if balance < required:
            raise OracleConnectionError(
                f"Insufficient funds for oracle account {self.account.address}. "
                f"Balance={balance} Wei, required={required} Wei "
                f"(value={value} + gas={tx['gas']} * gasPrice={tx['gasPrice']})."
            )

        signed = self.account.sign_transaction(tx)
        try:
            tx_hash = self.web3.eth.send_raw_transaction(signed.raw_transaction)
        except Web3RPCError as exc:
            raise OracleConnectionError(f"Transaction submission failed: {exc}") from exc
        return self.web3.to_hex(tx_hash)

    def get_round_status(self, round_number: int) -> int:
        round_data = self.get_round_struct(round_number)
        # If the contract exposes an explicit `status` numeric field, use it.
        status = round_data.get("status")
        if status is not None:
            return int(status)

        # Some ABIs return a `settled` or `isSettled` boolean instead of a
        # numeric status. Map that to our expected enum: 1=OPEN, 2=LOCKED, 3=FINISHED.
        for settled_key in ("settled", "isSettled", "resultSubmitted"):
            if settled_key in round_data:
                val = round_data.get(settled_key)
                if isinstance(val, bool):
                    return 3 if val else 1
                try:
                    return 3 if int(val) != 0 else 1
                except Exception:
                    continue

        # Fallback: infer status from on-chain timing fields (betting end / locks / endsAt).
        # If now < bettingEnd -> OPEN (1); if now >= bettingEnd and not settled -> LOCKED (2).
        time_keys = ("bettingEndTime", "locksAt", "locks_at", "endsAt", "ends_at", "opensAt", "startTime")
        onchain_ts = None
        for key in time_keys:
            if key in round_data and round_data.get(key) is not None:
                try:
                    onchain_ts = int(round_data.get(key))
                    break
                except Exception:
                    continue

        if onchain_ts is not None:
            try:
                latest_block = self.web3.eth.get_block("latest")
                latest_ts = int(latest_block.get("timestamp", 0))
                # If the betting end/lock/ends timestamp is in the future -> OPEN
                if latest_ts < onchain_ts:
                    return 1
                # Otherwise, betting window passed; treat as LOCKED (2)
                return 2
            except Exception:
                # If we cannot rely on block timestamp, fall through
                pass

        raise OracleConnectionError(f"Round {round_number} did not include a status or timing info")

    def get_final_vehicle_count(self, round_number: int) -> int | None:
        try:
            # The current RushBetting ABI exposes this field through getRound().
            value = self.get_round_struct(round_number).get("finalVehicleCount")
            return int(value) if value is not None else None
        except OracleConnectionError:
            return None

    def get_claim_status(self, player_address: str) -> str:
        return str(self.call_readonly("getClaimStatus", Web3.to_checksum_address(player_address)))

    def get_claimable_eth(self, player_address: str) -> int:
        return int(self.call_readonly("getClaimableEth", Web3.to_checksum_address(player_address)))

    def get_claimable_reward(self, player_address: str) -> int:
        return int(self.call_readonly("getClaimableReward", Web3.to_checksum_address(player_address)))

    def get_pending_reward(self, round_number: int, player_address: str) -> int:
        return int(self.call_readonly("pendingReward", round_number, Web3.to_checksum_address(player_address)))

    def has_claimed(self, round_number: int, player_address: str) -> bool:
        return bool(self.call_readonly("hasClaimed", round_number, Web3.to_checksum_address(player_address)))

    def has_rush_claimed(self, round_number: int, player_address: str) -> bool:
        if not self.is_connected():
            raise OracleConnectionError("RPC provider is not connected")

        try:
            event_filter = self.contract.events.RushClaimed().get_logs(
                fromBlock=0,
                toBlock=self.get_latest_block(),
                argument_filters={"winner": Web3.to_checksum_address(player_address)},
            )
        except Exception as exc:
            raise OracleConnectionError(f"Failed while fetching RushClaimed logs: {exc}") from exc

        return any(int(log["args"]["roundNumber"]) == round_number for log in event_filter)

    def get_user_bet(self, round_number: int, player_address: str) -> tuple[int, int]:
        result = self.call_readonly("getUserBet", round_number, Web3.to_checksum_address(player_address))
        if hasattr(result, "__len__"):
            return int(result[0]), int(result[1])
        return int(result["overAmount"] if "overAmount" in result else 0), int(result["underAmount"] if "underAmount" in result else 0)

    def get_round_participants(self, round_number: int) -> list[str]:
        participants = self.call_readonly("getRoundParticipants", round_number)
        return [str(x).lower() for x in participants]

    def get_protocol_fee_bps(self) -> int:
        # protocolFeeBps is a public Solidity variable, so its generated getter
        # replaces the removed getProtocolFeeBps() compatibility function.
        return int(self.call_readonly("protocolFeeBps"))

    def get_round_pools(self, round_number: int) -> tuple[int, int, int, int, int, int]:
        # Prefer reading the on-chain round struct (getRoundInfo / rounds mapping)
        try:
            struct = self.get_round_struct(round_number)
        except Exception as exc:
            raise OracleConnectionError(f"Failed while fetching round struct for pools: {exc}") from exc

        def _get_from_struct(d, *names, default=None):
            for n in names:
                try:
                    if isinstance(d, dict) and n in d and d.get(n) is not None:
                        return int(d.get(n))
                    if isinstance(d, dict) and n.lower() in d and d.get(n.lower()) is not None:
                        return int(d.get(n.lower()))
                except Exception:
                    continue
            if default is not None:
                return default
            raise KeyError

        try:
            over = _get_from_struct(struct, "overPool", "overPool_", "over_pool")
            under = _get_from_struct(struct, "underPool", "underPool_", "under_pool")
            total = _get_from_struct(struct, "totalPool", "totalPool_", "total_pool")

            # winningPool may be named `winningPool` in current ABI (not `winnerPool`).
            try:
                winner = _get_from_struct(struct, "winningPool", "winnerPool", "winningPool_", "winner_pool", "winning_pool")
            except KeyError:
                # Fallback: compute winner pool from winningSide if available
                winner = None
                try:
                    ws = struct.get("winningSide") if isinstance(struct, dict) else None
                    if ws is None:
                        ws = struct.get("winning_side") if isinstance(struct, dict) else None
                    if ws is not None:
                        # winningSide: 0 == OVER, 1 == UNDER (enum)
                        try:
                            ws_int = int(ws)
                            if ws_int == 0:
                                winner = int(over)
                            else:
                                winner = int(under)
                        except Exception:
                            # string name fallback
                            if isinstance(ws, str) and ws.upper().startswith("OVER"):
                                winner = int(over)
                            else:
                                winner = int(under)
                except Exception:
                    winner = None

            # loser pool: the opposite side
            loser = None
            if winner is None:
                # if we couldn't derive winner, try explicit loser field
                try:
                    loser = _get_from_struct(struct, "loserPool", "loserPool_", "loser_pool")
                except KeyError:
                    loser = None
            else:
                # compute loser from total/over/under if possible
                try:
                    if int(over) + int(under) == int(total):
                        loser = int(total) - int(winner)
                    else:
                        loser = int(total) - int(winner)
                except Exception:
                    loser = None

            # treasury/protocol fee stored under several potential names
            treasury = _get_from_struct(struct, "protocolFee", "treasuryFee", "treasuryFee_", "treasury_fee", default=0)

            # If some values are still None, raise a clear error
            if over is None or under is None or total is None:
                raise KeyError("missing over/under/total fields in round struct")
            if winner is None:
                # if winner still None, set to 0 to avoid breaking callers
                winner = 0
            if loser is None:
                loser = 0

            return (int(over), int(under), int(total), int(winner), int(loser), int(treasury))
        except Exception as exc:
            raise OracleConnectionError(f"Failed to parse round pools from struct: {exc}") from exc
    
    def get_round_struct(self, round_number: int) -> dict[str, Any]:
        if self.supports_function("getRound"):
            return self._get_legacy_round_struct(round_number)
        if self.supports_function("getRoundInfo"):
            data = self.call_readonly("getRoundInfo", round_number)
            if isinstance(data, dict):
                return data
            if isinstance(data, (tuple, list)):
                field_names = [
                    "roundId",
                    "startTime",
                    "bettingEndTime",
                    "threshold",
                    "totalPool",
                    "overPool",
                    "underPool",
                    "finalVehicleCount",
                    "protocolFee",
                    "claimablePool",
                    "winningPool",
                    "winningSide",
                    "settled",
                ]
                return {name: value for name, value in zip(field_names, data)}
            return {"raw": data}
        raise OracleConnectionError("Contract does not expose a round lookup method")

    def _get_legacy_round_struct(self, round_number: int) -> dict[str, Any]:
        """
        Queries and safely maps the exact 22 properties returned flatly by
        the compiled live RushBetting smart contract structure. Handles
        custom EVM reverts gracefully.
        """
        fn_abi = None
        for item in self.contract.abi:
            if item.get("type") == "function" and item.get("name") == "getRound":
                fn_abi = item
                break

        if fn_abi and len(fn_abi.get("outputs", [])) == 1 and fn_abi["outputs"][0].get("type") == "tuple":
            field_names = [c["name"] for c in fn_abi["outputs"][0].get("components", [])]
            comp_types = [c["type"] for c in fn_abi["outputs"][0].get("components", [])]
        else:
            field_names = [
                "roundNumber", "threshold", "finalVehicleCount", "result", "settledAt",
                "isSettled", "resultSubmitted", "winningSide", "totalPool", "winnerPool",
                "loserPool", "treasuryFee", "protocolFeeBps", "buybackShareBps",
                "buybackAllocation", "operationsAllocation", "opensAt", "locksAt",
                "endsAt", "commitmentHash", "status", "exists"
            ]
            comp_types = [
                "uint256", "uint256", "uint256", "uint256", "uint256",
                "bool", "bool", "uint8",
                "uint256", "uint256", "uint256", "uint256", "uint256", "uint256", "uint256", "uint256", "uint256", "uint256", "uint256",
                "bytes32", "uint8", "bool"
            ]

        tuple_type_signature = f"({','.join(comp_types)})"
        output_types = [tuple_type_signature]
        function_selector = self.web3.keccak(text="getRound(uint256)")[:4]
        encoded_args = self.web3.codec.encode(["uint256"], [round_number])
        call_data = function_selector + encoded_args

        response = self.web3.eth.call({"to": self.contract_address, "data": call_data})

        if not response or response == b'':
            raise OracleConnectionError(f"Empty data block returned for round {round_number}")

        if response.startswith(b'\x66\x67\x10\xf4') or len(response) <= 4:
            raise OracleConnectionError(
                f"On-chain call reverted: RoundNotFound() for round index #{round_number}."
            )

        try:
            decoded_tuple = self.web3.codec.decode(output_types, response)
        except Exception:
            try:
                decoded_tuple = self.web3.codec.decode(comp_types, response)
            except Exception:
                words = [response[i:i + 32] for i in range(0, len(response), 32)]
                decoded_len_raw = len(words)
                if decoded_len_raw >= 22:
                    names = [
                        "roundNumber", "threshold", "finalVehicleCount", "result", "settledAt",
                        "isSettled", "resultSubmitted", "winningSide", "totalPool", "winnerPool",
                        "loserPool", "treasuryFee", "protocolFeeBps", "buybackShareBps",
                        "buybackAllocation", "operationsAllocation", "opensAt", "locksAt",
                        "endsAt", "commitmentHash", "status", "exists"
                    ]
                elif decoded_len_raw == 17:
                    names = [
                        "roundNumber", "threshold", "finalVehicleCount", "result", "settledAt",
                        "isSettled", "resultSubmitted", "winningSide", "totalPool", "winnerPool",
                        "loserPool", "treasuryFee", "protocolFeeBps", "buybackShareBps",
                        "buybackAllocation", "operationsAllocation", "opensAt"
                    ]
                elif decoded_len_raw == 15:
                    names = [
                        "roundNumber", "threshold", "finalVehicleCount", "result", "settledAt",
                        "isSettled", "resultSubmitted", "winningSide", "totalPool", "winnerPool",
                        "loserPool", "treasuryFee", "protocolFeeBps", "buybackShareBps",
                        "buybackAllocation"
                    ]
                else:
                    names = [
                        "roundNumber", "threshold", "finalVehicleCount", "result", "settledAt",
                        "isSettled", "resultSubmitted", "winningSide", "totalPool", "winnerPool",
                        "loserPool", "treasuryFee", "protocolFeeBps", "buybackShareBps",
                        "buybackAllocation", "operationsAllocation", "opensAt", "locksAt",
                        "endsAt", "commitmentHash", "status", "exists"
                    ][:decoded_len_raw]

                result = {}
                for i, name in enumerate(names):
                    value = int.from_bytes(words[i], "big")
                    if name == "commitmentHash":
                        value = "0x" + words[i].hex()
                    elif name in ("isSettled", "resultSubmitted", "exists"):
                        value = int.from_bytes(words[i], "big") != 0
                    result[name] = value
                return result

        actual_values = decoded_tuple[0] if isinstance(decoded_tuple, (tuple, list)) and len(decoded_tuple) == 1 else decoded_tuple
        result = {}
        for i, name in enumerate(field_names):
            try:
                value = actual_values[i]
                if isinstance(value, (bytes, bytearray)):
                    value = "0x" + bytes(value).hex()
                result[name] = value
            except Exception:
                result[name] = None
        return result

    def get_transaction_receipt(self, tx_hash: str) -> Any | None:
        try:
            return self.web3.eth.get_transaction_receipt(tx_hash)
        except TransactionNotFound:
            return None
        except Exception as exc:
            raise OracleConnectionError(f"Failed while retrieving transaction receipt: {exc}") from exc

    def verify_place_bet_transaction(
        self,
        tx_hash: str,
        *,
        wallet_address: str,
        round_number: int,
        side: int,
        amount_wei: int,
    ) -> None:
        """Validate that a mined transaction is the exact expected placeBet call."""
        receipt = self.get_transaction_receipt(tx_hash)
        if receipt is None:
            raise OracleConnectionError("Bet transaction has not been mined")
        receipt_status = getattr(receipt, "status", None)
        if receipt_status is None and hasattr(receipt, "get"):
            receipt_status = receipt.get("status")
        if int(receipt_status or 0) != 1:
            raise OracleConnectionError("Bet transaction reverted")

        try:
            transaction = self.web3.eth.get_transaction(tx_hash)
            destination = transaction.get("to") if hasattr(transaction, "get") else transaction.to
            sender = transaction.get("from") if hasattr(transaction, "get") else transaction["from"]
            value = transaction.get("value") if hasattr(transaction, "get") else transaction.value
            calldata = (
                transaction.get("input") if hasattr(transaction, "get") else getattr(transaction, "input", None)
            )
            if calldata is None and hasattr(transaction, "get"):
                calldata = transaction.get("data")
            if destination is None or Web3.to_checksum_address(destination) != self.contract_address:
                raise OracleConnectionError("Bet transaction was not sent to RushBetting")
            if Web3.to_checksum_address(sender).lower() != Web3.to_checksum_address(wallet_address).lower():
                raise OracleConnectionError("Bet transaction sender does not match wallet")
            if int(value) != amount_wei:
                raise OracleConnectionError("Bet transaction value does not match requested amount")

            function, parameters = self.contract.decode_function_input(calldata)
            print(f"DEBUG: Decoded tx function: {function.fn_name}, parameters: {parameters}")
            # Accept either `placeBet` or `bet` function names depending on ABI variant
            if function.fn_name not in ("placeBet", "bet"):
                raise OracleConnectionError("Transaction is not a placeBet/bet call")

            # Handle ABI parameter name differences across compiled artifacts
            # Common names: roundNumber, roundId, round_id
            round_param = None
            for key in ("roundNumber", "roundId", "round_id", "round"):
                if key in parameters:
                    round_param = parameters[key]
                    break
            # Side param is commonly named 'side'
            side_param = parameters.get("side") if "side" in parameters else None

            if round_param is None or side_param is None:
                raise OracleConnectionError("Bet transaction arguments missing roundNumber/side")

            if int(round_param) != round_number or int(side_param) != side:
                raise OracleConnectionError("Bet transaction arguments do not match the requested round or side")
        except OracleConnectionError:
            raise
        except Exception as exc:
            raise OracleConnectionError(f"Unable to verify bet transaction: {exc}") from exc

    def wait_for_transaction_receipt(self, tx_hash: str, timeout: int = 120) -> Any:
        try:
            return self.web3.eth.wait_for_transaction_receipt(tx_hash, timeout=timeout)
        except Exception as exc:
            raise OracleConnectionError(f"Failed while waiting for transaction receipt: {exc}") from exc

    def decode_round_settled_event(self, receipt: Any) -> dict[str, int] | None:
        logs = receipt.get("logs")
        if not logs:
            return None
        # First, attempt to use the contract event parser on the full receipt
        try:
            processed = self.contract.events.RoundSettled().processReceipt(receipt)
            if processed:
                ev = processed[0]
                args = ev.get("args", {}) if isinstance(ev, dict) else getattr(ev, "args", {})
                if args:
                    return self._normalize_settled_event_args(args, receipt)
        except Exception:
            pass

        # Fallback: scan individual logs
        for log in logs:
            try:
                event = self.contract.events.RoundSettled().process_log(log)
                args = event.get("args", {}) if isinstance(event, dict) else getattr(event, "args", {})
                if args:
                    return self._normalize_settled_event_args(args, receipt)
            except Exception:
                continue

        return None

    def _normalize_settled_event_args(self, args: Any, receipt: Any) -> dict[str, int]:
        # Accept a variety of arg naming conventions emitted by different
        # contract ABIs and map them to our canonical keys.
        def _extract(vals, choices):
            for k in choices:
                try:
                    if k in vals:
                        return vals[k]
                except Exception:
                    try:
                        return getattr(vals, k)
                    except Exception:
                        continue
            return None

        round_val = _extract(args, ("roundNumber", "roundId", "round", "round_number", "roundId_"))
        final_val = _extract(args, ("finalVehicleCount", "final_vehicle_count", "finalVehicle", "finalCount", "final"))
        settled_at_val = _extract(args, ("settledAt", "settled_at", "timestamp", "time"))

        # Normalize numeric fields
        try:
            round_number = int(round_val) if round_val is not None else None
        except Exception:
            round_number = None
        try:
            final_vehicle_count = int(final_val) if final_val is not None else None
        except Exception:
            final_vehicle_count = None

        if settled_at_val is None:
            # Try to infer timestamp from receipt blockNumber if present
            try:
                blk = receipt.get("blockNumber")
                if blk is not None:
                    block = self.web3.eth.get_block(blk)
                    settled_at_val = int(block.get("timestamp", 0))
            except Exception:
                settled_at_val = None

        try:
            settled_at = int(settled_at_val) if settled_at_val is not None else None
        except Exception:
            settled_at = None

        return {
            "round_number": round_number,
            "final_vehicle_count": final_vehicle_count,
            "settled_at": settled_at,
        }
