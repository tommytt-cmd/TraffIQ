from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID
import random

from web3 import Web3

from app.core.enums import FinancialReconciliationStatus, RoundStatus, SettlementStatus, VideoStatus
from app.models.round import Round
from app.models.round_transaction import RoundTransactionStatus, RoundTransactionType
import uuid
from app.models.video import Video
from app.oracle.client import OracleClient, OracleConnectionError
from app.repositories.round_repository import RoundRepository
from app.repositories.round_transaction_repository import RoundTransactionRepository
from app.repositories.video_repository import VideoRepository
from app.settings import settings


logging.basicConfig(
    filename="logs/round_service.log",
    filemode="a",
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)

logger = logging.getLogger("game")


class RoundService:
    def __init__(
        self,
        round_repository: RoundRepository,
        video_repository: VideoRepository,
        oracle_client: OracleClient | None = None,
        round_transaction_repository: RoundTransactionRepository | None = None,
    ) -> None:
        self.round_repository = round_repository
        self.video_repository = video_repository
        self.oracle_client = oracle_client
        self.round_transaction_repository = round_transaction_repository
        
    def get_single_threshold(self, target_value, offset_range=(3, 4)):
        min_off, max_off = offset_range
        options = [
            target_value + min_off,
            target_value + max_off,
            target_value - min_off,
            target_value - max_off
        ]
        
        return random.choice(options)

    async def create_round(self) -> Round:
        current = await self.round_repository.get_current_round()
        if current is not None and current.status != RoundStatus.FINISHED:
            return current

        # 1. Initialize a generic local model record
        round_model = await self.round_repository.create()

        # FIXED: Synchronize local round numbering directly with the live EVM state
        if self.oracle_client is not None and self.oracle_client.is_connected():
            try:
                # Query what number the smart contract exposes as the current round
                # (use `currentRoundId` instead of legacy `latestRound`). If the
                # on-chain current is 1003, the new round we create will be 1004.
                onchain_latest = await asyncio.to_thread(self.oracle_client.call_readonly, "currentRoundId")
                next_round_number = int(onchain_latest) + 1
                
                logger.info(f"[+] Synchronizing round sequence: setting local DB to follow on-chain index #{next_round_number}")
                round_model.round_number = next_round_number
                await self.round_repository.update(round_model)
            except Exception as e:
                logger.error(f"[-] Critical: Failed to pull on-chain latestRound index: {e}")
                # Fallback to local auto-incrementing if the RPC channel fails
                if round_model.round_number is None:
                    round_model.round_number = 1004 
                    await self.round_repository.update(round_model)

        # 2. Continue with your standard video assignment and metadata timing rules
        ready_video = await self.video_repository.get_ready()
        
        # If no ready videos available, recycle all videos back to READY
        if ready_video is None:
            logger.warning("no_ready_videos_available_recycling_all")
            await self.video_repository.update_status_for_all(VideoStatus.READY)
            # Try again to get a ready video
            ready_video = await self.video_repository.get_ready()
        
        if ready_video is not None:
            round_model.video_id = ready_video.id
            await self.round_repository.update(round_model)
            # Mark video as IN_USE to prevent reuse in concurrent rounds
            await self.video_repository.update_status(ready_video, VideoStatus.IN_USE)
            logger.info("round_assigned_video", extra={"round_id": str(round_model.id), "video_id": str(ready_video.id)})
        else:
            logger.error("no_videos_available_after_recycling")

        now = datetime.now(timezone.utc).replace(microsecond=0)
        round_model.starts_at = now
        round_model.betting_closes_at = now + timedelta(seconds=settings.BETTING_DURATION_SECONDS)
        round_model.locked_ends_at = round_model.betting_closes_at + timedelta(seconds=settings.LOCKED_DURATION_SECONDS)
        round_model.live_ends_at = round_model.locked_ends_at + timedelta(seconds=settings.LIVE_DURATION_SECONDS)
        round_model.ends_at = round_model.live_ends_at + timedelta(seconds=settings.SETTLING_DURATION_SECONDS)
        await self.round_repository.update(round_model)

        threshold = settings.THRESHOLD
        if ready_video is not None:
            threshold = self.get_single_threshold(ready_video.vehicle_total)
        round_model.threshold = int(threshold)
        await self.round_repository.update(round_model)

        # NOTE: Do not create the on-chain round during local creation.
        # The lifecycle is: create the round locally, and only when the
        # operator/worker calls `open_round` do we create the on-chain round
        # via `createRound` if it does not already exist. This avoids racing
        # with local scheduling and keeps `create_round` fast and reliable.

        logger.info("round_created", extra={"round_id": str(round_model.id)})
        return round_model

    def _build_commitment_hash(self, round_model: Round, threshold: int) -> bytes:
        payload = {
            "round_id": str(round_model.id),
            "round_number": int(round_model.round_number) if round_model.round_number is not None else None,
            "video_id": str(round_model.video_id) if round_model.video_id else None,
            "threshold": int(threshold),
            "opens_at": int(round_model.starts_at.timestamp()) if round_model.starts_at else None,
            "locks_at": int(round_model.betting_closes_at.timestamp()) if round_model.betting_closes_at else None,
            "ends_at": int(round_model.live_ends_at.timestamp()) if round_model.live_ends_at else None,
            "settlement_at": int(round_model.ends_at.timestamp()) if round_model.ends_at else None,
            "server_seed": settings.SERVER_SEED,
        }
        message = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        return Web3.keccak(text=message)

    async def open_round(self, round_id: UUID) -> Round:
        print(f"Opening round {round_id}")
        round_model = await self.round_repository.get_by_id(round_id)
        if round_model is None:
            raise ValueError("Round not found")
        if round_model.status == RoundStatus.FINISHED:
            raise ValueError("Finished rounds cannot be reopened")
        if round_model.status != RoundStatus.WAITING:
            return round_model

        if round_model.starts_at is None:
            round_model.starts_at = datetime.now(timezone.utc).replace(microsecond=0)
        if round_model.betting_closes_at is None:
            round_model.betting_closes_at = round_model.starts_at + timedelta(seconds=settings.BETTING_DURATION_SECONDS)
        if round_model.locked_ends_at is None:
            round_model.locked_ends_at = round_model.betting_closes_at + timedelta(seconds=settings.LOCKED_DURATION_SECONDS)
        if round_model.live_ends_at is None:
            round_model.live_ends_at = round_model.locked_ends_at + timedelta(seconds=settings.LIVE_DURATION_SECONDS)
        if round_model.ends_at is None:
            round_model.ends_at = round_model.live_ends_at + timedelta(seconds=settings.SETTLING_DURATION_SECONDS)

        if self.oracle_client is None:
            round_model.status = RoundStatus.OPEN
            await self.round_repository.update(round_model)
            logger.info("round_opened", extra={"round_id": str(round_model.id)})
            return round_model

        if self.round_transaction_repository is None:
            raise RuntimeError("Round transaction repository is not configured")

        if round_model.round_number is None:
            raise ValueError("Round number is required for on-chain round opening")

        oracle_address = self.oracle_client.get_onchain_oracle()
        if self.oracle_client.account is None or self.oracle_client.account.address.lower() != oracle_address.lower():
            raise OracleConnectionError(
                f"Oracle signer {self.oracle_client.account.address if self.oracle_client.account else None} "
                f"does not match deployed contract oracle {oracle_address}"
            )

        transaction = await self.round_transaction_repository.get_by_round_and_type(
            round_model.id,
            RoundTransactionType.OPEN_ROUND.value,
        )

        if transaction is not None:
            print(f"Existing open round transaction found: {transaction.transaction_hash} with status {transaction.status}")
            if transaction.status == RoundTransactionStatus.CONFIRMED.value:
                round_model.status = RoundStatus.OPEN
                await self.round_repository.update(round_model)
                return round_model
            if transaction.status == RoundTransactionStatus.PENDING.value:
                # The contract no longer exposes an `openRound` tx; instead rely
                # on the on-chain round status to determine openness and mark
                # the pending transaction as confirmed if the on-chain status
                # indicates OPEN.
                onchain_status = await asyncio.to_thread(
                    self.oracle_client.get_round_status,
                    int(round_model.round_number),
                )
                if onchain_status == 1:
                    await self.round_transaction_repository.update_status(
                        transaction,
                        RoundTransactionStatus.CONFIRMED.value,
                    )
                    round_model.status = RoundStatus.OPEN
                    await self.round_repository.update(round_model)
                    return round_model
                raise OracleConnectionError(
                    "Previous open round transaction pending but on-chain round is not OPEN"
                )
            if transaction.status == RoundTransactionStatus.FAILED.value:
                onchain_status = await asyncio.to_thread(
                    self.oracle_client.get_round_status,
                    int(round_model.round_number),
                )
                if onchain_status == 1:
                    await self.round_transaction_repository.update_status(
                        transaction,
                        RoundTransactionStatus.CONFIRMED.value,
                    )
                    round_model.status = RoundStatus.OPEN
                    await self.round_repository.update(round_model)
                    return round_model
                raise OracleConnectionError(
                    "Previous open round transaction failed and on-chain round is not OPEN"
                )

        try:
            print(f"Checking if on-chain round {round_model.round_number} exists")
            # If the on-chain round isn't present, attempt to create it first
            exists = await asyncio.to_thread(
                self.oracle_client.round_exists,
                int(round_model.round_number),
            )
            if not exists:
                print(f"On-chain round {round_model.round_number} does not exist; attempting to create it")
                logger.warning(
                    "onchain_round_missing_attempting_create",
                    extra={"round_id": str(round_model.id), "round_number": int(round_model.round_number)},
                )
                # build commitment using the stored threshold (fallback to settings)
                threshold = int(round_model.threshold) if round_model.threshold is not None else int(settings.THRESHOLD)

                # The live RushBetting contract exposes `createRound(uint256 threshold, uint64 durationSeconds)`
                # which assigns the on-chain round id internally. Call that signature and then read
                # `currentRoundId` to map the on-chain round number back to our local model.
                duration_seconds = 0
                try:
                    if round_model.betting_closes_at is not None and round_model.starts_at is not None:
                        duration_seconds = int(round_model.betting_closes_at.timestamp() - round_model.starts_at.timestamp())
                except Exception:
                    duration_seconds = int(settings.BETTING_DURATION_SECONDS)

                try:
                    tx_create = await asyncio.to_thread(
                        self.oracle_client.send_transaction,
                        "createRound",
                        int(threshold),
                        int(duration_seconds),
                    )
                    print(f"createRound tx submitted: {tx_create}")
                    logger.info("create_round_tx_submitted", extra={"tx_hash": tx_create})
                    # wait for createRound to be mined/confirmed before proceeding
                    await asyncio.to_thread(self.oracle_client.wait_for_transaction_receipt, tx_create)

                    # Map local round to the on-chain assigned id
                    onchain_latest = await asyncio.to_thread(self.oracle_client.call_readonly, "currentRoundId")
                    round_model.round_number = int(onchain_latest)
                    await self.round_repository.update(round_model)
                    logger.info("mapped_local_round_to_onchain", extra={"round_id": str(round_model.id), "round_number": int(round_model.round_number)})
                    # Synchronize local timing metadata with the on-chain round
                    try:
                        onchain_struct = await asyncio.to_thread(
                            self.oracle_client.get_round_struct,
                            int(round_model.round_number),
                        )
                        # Prefer common keys from getRoundInfo: startTime, bettingEndTime
                        starts_at_ts = None
                        betting_end_ts = None
                        for key in ("startTime", "opensAt", "start_time"):
                            if isinstance(onchain_struct, dict) and key in onchain_struct and onchain_struct.get(key) is not None:
                                try:
                                    starts_at_ts = int(onchain_struct.get(key))
                                    break
                                except Exception:
                                    continue
                        for key in ("bettingEndTime", "locksAt", "locks_at", "endsAt", "ends_at"):
                            if isinstance(onchain_struct, dict) and key in onchain_struct and onchain_struct.get(key) is not None:
                                try:
                                    betting_end_ts = int(onchain_struct.get(key))
                                    break
                                except Exception:
                                    continue

                        if starts_at_ts is not None:
                            round_model.starts_at = datetime.fromtimestamp(starts_at_ts, timezone.utc)
                        if betting_end_ts is not None:
                            round_model.betting_closes_at = datetime.fromtimestamp(betting_end_ts, timezone.utc)
                            # Recompute dependent windows relative to betting_closes_at
                            round_model.locked_ends_at = round_model.betting_closes_at + timedelta(seconds=settings.LOCKED_DURATION_SECONDS)
                            round_model.live_ends_at = round_model.locked_ends_at + timedelta(seconds=settings.LIVE_DURATION_SECONDS)
                            round_model.ends_at = round_model.live_ends_at + timedelta(seconds=settings.SETTLING_DURATION_SECONDS)
                        await self.round_repository.update(round_model)
                        logger.info("synced_local_timing_with_onchain", extra={"round_id": str(round_model.id), "round_number": int(round_model.round_number)})
                    except Exception as _sync_exc:
                        logger.warning("failed_syncing_local_timing", extra={"round_id": str(round_model.id), "error": str(_sync_exc)})
                except Exception as exc:
                    print(f"createRound failed: {exc}")
                    logger.error("create_round_onchain_failed", extra={"round_id": str(round_model.id), "error": str(exc)})
                    raise OracleConnectionError(f"Round {round_model.round_number} does not exist on-chain and createRound failed: {exc}")

            # The on-chain contract does not implement `openRound`. Treat the
            # presence of the on-chain round (or a successful createRound)
            # as authority to mark the round open and emit a synthetic
            # confirmed OPEN_ROUND transaction for auditing consistency.
            synthetic_tx = None
            # If a createRound was submitted above, we waited for it. Now
            # create a synthetic confirmed OPEN_ROUND transaction record.
            if self.round_transaction_repository is not None:
                print(f"Creating synthetic OPEN_ROUND transaction for round {round_model.round_number}")
                synthetic_tx = "0x" + uuid.uuid4().hex
                transaction = await self.round_transaction_repository.create(
                    round_model.id,
                    int(round_model.round_number),
                    RoundTransactionType.OPEN_ROUND.value,
                    synthetic_tx,
                )
                await self.round_transaction_repository.update_status(
                    transaction,
                    RoundTransactionStatus.CONFIRMED.value,
                    None,
                    synthetic_tx,
                )

            round_model.status = RoundStatus.OPEN
            await self.round_repository.update(round_model)
            return round_model
        except OracleConnectionError as exc:
            if transaction is not None:
                await self.round_transaction_repository.update_status(
                    transaction,
                    RoundTransactionStatus.FAILED.value,
                    str(exc),
                )
            raise

    async def _confirm_open_round_transaction(
        self,
        round_model: Round,
        transaction: "app.models.round_transaction.RoundTransaction",
    ) -> None:
        if self.oracle_client is None:
            raise OracleConnectionError("Oracle client is not configured")

        try:
            receipt = await asyncio.to_thread(
                self.oracle_client.wait_for_transaction_receipt,
                transaction.transaction_hash,
            )
        except OracleConnectionError as exc:
            await self.round_transaction_repository.update_status(
                transaction,
                RoundTransactionStatus.FAILED.value,
                str(exc),
            )
            raise

        status = getattr(receipt, "status", None) or receipt.get("status")
        if status != 1:
            await self.round_transaction_repository.update_status(
                transaction,
                RoundTransactionStatus.FAILED.value,
                f"Transaction reverted or failed with status={status}",
            )
            raise OracleConnectionError(
                f"Open round transaction {transaction.transaction_hash} failed with status={status}"
            )

        onchain_status = await asyncio.to_thread(
            self.oracle_client.get_round_status,
            int(round_model.round_number),
        )
        if onchain_status != 1:
            await self.round_transaction_repository.update_status(
                transaction,
                RoundTransactionStatus.FAILED.value,
                f"On-chain round status is {onchain_status} after openRound confirmation",
            )
            raise OracleConnectionError(
                f"Open round transaction {transaction.transaction_hash} confirmed but round status is {onchain_status}"
            )

        await self.round_transaction_repository.update_status(
            transaction,
            RoundTransactionStatus.CONFIRMED.value,
        )
        logger.info(
            "round_opened_on_chain",
            extra={
                "round_id": str(round_model.id),
                "round_number": int(round_model.round_number),
                "tx_hash": transaction.transaction_hash,
            },
        )

    async def lock_round(self, round_id: UUID) -> Round:
        round_model = await self.round_repository.get_by_id(round_id)
        if round_model is None:
            raise ValueError("Round not found")
        if round_model.status == RoundStatus.FINISHED:
            raise ValueError("Finished rounds cannot be locked")
        if round_model.status != RoundStatus.OPEN:
            return round_model

        if self.oracle_client is None:
            round_model.status = RoundStatus.LOCKED
            await self.round_repository.update(round_model)
            logger.info("round_locked", extra={"round_id": str(round_model.id)})
            return round_model

        if self.round_transaction_repository is None:
            raise RuntimeError("Round transaction repository is not configured")

        if round_model.round_number is None:
            raise ValueError("Round number is required for on-chain round locking")

        oracle_address = self.oracle_client.get_onchain_oracle()
        if self.oracle_client.account is None or self.oracle_client.account.address.lower() != oracle_address.lower():
            raise OracleConnectionError(
                f"Oracle signer {self.oracle_client.account.address if self.oracle_client.account else None} "
                f"does not match deployed contract oracle {oracle_address}"
            )

        transaction = await self.round_transaction_repository.get_by_round_and_type(
            round_model.id,
            RoundTransactionType.LOCK_ROUND.value,
        )

        if transaction is not None:
            if transaction.status == RoundTransactionStatus.CONFIRMED.value:
                round_model.status = RoundStatus.LOCKED
                await self.round_repository.update(round_model)
                return round_model
            if transaction.status == RoundTransactionStatus.PENDING.value:
                await self._confirm_lock_round_transaction(round_model, transaction)
                round_model.status = RoundStatus.LOCKED
                await self.round_repository.update(round_model)
                return round_model
            if transaction.status == RoundTransactionStatus.FAILED.value:
                onchain_status = await asyncio.to_thread(
                    self.oracle_client.get_round_status,
                    int(round_model.round_number),
                )
                if onchain_status == 2:
                    await self.round_transaction_repository.update_status(
                        transaction,
                        RoundTransactionStatus.CONFIRMED.value,
                    )
                    round_model.status = RoundStatus.LOCKED
                    await self.round_repository.update(round_model)
                    return round_model
                raise OracleConnectionError(
                    "Previous lock round transaction failed and on-chain round is not LOCKED"
                )

        # Use the local `betting_closes_at` as the canonical lock point and
        # avoid calling the on-chain `lockRound` transaction. The oracle actor
        # should rely on the round's `betting_closes_at` timestamp to transition
        # to LOCKED state.
        now = datetime.now(timezone.utc)
        if round_model.betting_closes_at is None:
            raise OracleConnectionError("Round betting end time not set; cannot lock")

        if now < round_model.betting_closes_at:
            # Not yet time to lock the round
            raise OracleConnectionError(
                f"Cannot lock round before betting end: {round_model.betting_closes_at.isoformat()} (now: {now.isoformat()})"
            )

        # Mark the round as locked locally (no on-chain lock transaction).
        round_model.status = RoundStatus.LOCKED
        await self.round_repository.update(round_model)

        # Create a local confirmed lock transaction record so callers and
        # monitoring systems retain an audit trail similar to on-chain flows.
        if self.round_transaction_repository is not None:
            synthetic_tx = "0x" + uuid.uuid4().hex
            transaction = await self.round_transaction_repository.create(
                round_model.id,
                int(round_model.round_number),
                RoundTransactionType.LOCK_ROUND.value,
                synthetic_tx,
            )
            await self.round_transaction_repository.update_status(
                transaction,
                RoundTransactionStatus.CONFIRMED.value,
                None,
                synthetic_tx,
            )

        logger.info("round_locked_via_local_timer", extra={"round_id": str(round_model.id)})
        return round_model

    async def _confirm_lock_round_transaction(
        self,
        round_model: Round,
        transaction: "app.models.round_transaction.RoundTransaction",
    ) -> None:
        if self.oracle_client is None:
            raise OracleConnectionError("Oracle client is not configured")

        try:
            receipt = await asyncio.to_thread(
                self.oracle_client.wait_for_transaction_receipt,
                transaction.transaction_hash,
            )
        except OracleConnectionError as exc:
            await self.round_transaction_repository.update_status(
                transaction,
                RoundTransactionStatus.FAILED.value,
                str(exc),
            )
            raise

        status = getattr(receipt, "status", None) or receipt.get("status")
        if status != 1:
            await self.round_transaction_repository.update_status(
                transaction,
                RoundTransactionStatus.FAILED.value,
                f"Transaction reverted or failed with status={status}",
            )
            raise OracleConnectionError(
                f"Lock round transaction {transaction.transaction_hash} failed with status={status}"
            )

        onchain_status = await asyncio.to_thread(
            self.oracle_client.get_round_status,
            int(round_model.round_number),
        )
        if onchain_status != 2:
            await self.round_transaction_repository.update_status(
                transaction,
                RoundTransactionStatus.FAILED.value,
                f"On-chain round status is {onchain_status} after lockRound confirmation",
            )
            raise OracleConnectionError(
                f"Lock round transaction {transaction.transaction_hash} confirmed but round status is {onchain_status}"
            )

        await self.round_transaction_repository.update_status(
            transaction,
            RoundTransactionStatus.CONFIRMED.value,
        )
        logger.info(
            "round_locked_on_chain",
            extra={
                "round_id": str(round_model.id),
                "round_number": int(round_model.round_number),
                "tx_hash": transaction.transaction_hash,
            },
        )

    async def submit_result(self, round_id: UUID, result: int) -> Round:
        if result < 0:
            raise ValueError("Result cannot be negative")

        if self.oracle_client is None:
            round_model = await self.round_repository.get_by_id(round_id)
            if round_model is None:
                raise ValueError("Round not found")
            if round_model.status not in (RoundStatus.LOCKED, RoundStatus.LIVE):
                raise ValueError("Round must be locked or live to submit result")
            round_model.result = result
            round_model.status = RoundStatus.SETTLED
            round_model.settlement_status = SettlementStatus.CONFIRMED.value
            round_model.settlement_confirmed_at = datetime.now(timezone.utc)
            await self.round_repository.update(round_model)
            logger.info("result_submitted_locally", extra={"round_id": str(round_model.id), "result": result})
            return round_model

        if self.round_transaction_repository is None:
            raise RuntimeError("Round transaction repository is not configured")

        round_model = await self.round_repository.get_by_id_for_update(round_id)
        if round_model is None:
            raise ValueError("Round not found")
        if round_model.status not in (RoundStatus.LOCKED, RoundStatus.LIVE, RoundStatus.SETTLED):
            raise ValueError("Round must be locked or live to submit result")
        if round_model.round_number is None:
            raise ValueError("Round number is required for on-chain result submission")

        oracle_address = self.oracle_client.get_onchain_oracle()
        if self.oracle_client.account is None or self.oracle_client.account.address.lower() != oracle_address.lower():
            raise OracleConnectionError(
                f"Oracle signer {self.oracle_client.account.address if self.oracle_client.account else None} "
                f"does not match deployed contract oracle {oracle_address}"
            )

        transaction = await self.round_transaction_repository.get_by_round_and_type(
            round_model.id,
            RoundTransactionType.SUBMIT_RESULT.value,
        )

        if transaction is None and round_model.settlement_tx_hash:
            transaction = await self.round_transaction_repository.get_by_transaction_hash(
                round_model.settlement_tx_hash
            )
            if transaction is None:
                transaction = await self.round_transaction_repository.create(
                    round_model.id,
                    int(round_model.round_number),
                    RoundTransactionType.SUBMIT_RESULT.value,
                    round_model.settlement_tx_hash,
                )

        if round_model.settlement_status == SettlementStatus.CONFIRMED.value:
            round_model.result = result
            round_model.status = RoundStatus.SETTLED
            round_model.settlement_confirmed_at = round_model.settlement_confirmed_at or datetime.now(timezone.utc)
            await self._reconcile_onchain_financials(round_model, result)
            await self.round_repository.update(round_model)
            return round_model

        if transaction is not None:
            if transaction.status == RoundTransactionStatus.CONFIRMED.value:
                round_model.result = result
                round_model.status = RoundStatus.SETTLED
                round_model.settlement_status = SettlementStatus.CONFIRMED.value
                round_model.settlement_confirmed_at = round_model.settlement_confirmed_at or datetime.now(timezone.utc)
                await self._reconcile_onchain_financials(round_model, result)
                await self.round_repository.update(round_model)
                return round_model

            if transaction.status == RoundTransactionStatus.PENDING.value or round_model.settlement_status == SettlementStatus.PENDING.value:
                await self._confirm_submit_result_transaction(round_model, transaction, result)
                round_model.result = result
                round_model.status = RoundStatus.SETTLED
                round_model.settlement_status = SettlementStatus.CONFIRMED.value
                round_model.settlement_confirmed_at = datetime.now(timezone.utc)
                await self.round_repository.update(round_model)
                return round_model

            if transaction.status == RoundTransactionStatus.FAILED.value or round_model.settlement_status == SettlementStatus.FAILED.value:
                if round_model.settlement_tx_hash:
                    receipt = await asyncio.to_thread(
                        self.oracle_client.get_transaction_receipt,
                        round_model.settlement_tx_hash,
                    )
                    if receipt is not None:
                        status = getattr(receipt, "status", None) or receipt.get("status")
                        if status == 1:
                            await self._confirm_submit_result_transaction(round_model, transaction, result)
                            round_model.result = result
                            round_model.status = RoundStatus.SETTLED
                            round_model.settlement_status = SettlementStatus.CONFIRMED.value
                            round_model.settlement_confirmed_at = datetime.now(timezone.utc)
                            await self.round_repository.update(round_model)
                            return round_model
                        if status == 0:
                            round_model.settlement_status = SettlementStatus.FAILED.value
                            await self.round_repository.update(round_model)
                            if transaction is not None:
                                await self.round_transaction_repository.update_status(
                                    transaction,
                                    RoundTransactionStatus.FAILED.value,
                                    "On-chain transaction reverted",
                                )
                            transaction = None

                onchain_result = await asyncio.to_thread(
                    self.oracle_client.get_final_vehicle_count,
                    int(round_model.round_number),
                )
                if onchain_result is not None and onchain_result != result:
                    raise OracleConnectionError("on-chain result does not match")

        if round_model.settlement_status in (SettlementStatus.NOT_STARTED.value, SettlementStatus.FAILED.value):
            round_model.result = result
            round_model.status = RoundStatus.SETTLED
            round_model.settlement_status = SettlementStatus.SUBMITTING.value
            round_model.settlement_submitted_at = datetime.now(timezone.utc)
            await self.round_repository.update(round_model)

            try:
                if not await asyncio.to_thread(
                    self.oracle_client.round_exists,
                    int(round_model.round_number),
                ):
                    raise OracleConnectionError(
                        f"Round {round_model.round_number} does not exist on-chain"
                    )

                # Preflight: fetch round struct and ensure betting window closed
                try:
                    onchain_struct = await asyncio.to_thread(
                        self.oracle_client.get_round_struct,
                        int(round_model.round_number),
                    )
                except Exception:
                    onchain_struct = {}

                betting_end = None
                for key in ("bettingEndTime", "locksAt", "locks_at", "endsAt", "ends_at"):
                    if isinstance(onchain_struct, dict) and key in onchain_struct and onchain_struct.get(key) is not None:
                        try:
                            betting_end = int(onchain_struct.get(key))
                            break
                        except Exception:
                            continue

                if betting_end is not None:
                    now_ts = int(datetime.now(timezone.utc).timestamp())
                    if now_ts < betting_end:
                        raise OracleConnectionError(
                            f"Cannot submit result before betting end (on-chain: {betting_end}, now: {now_ts})"
                        )

                    # Also ensure local timer indicates betting has closed
                    if round_model.betting_closes_at is not None:
                        now = datetime.now(timezone.utc)
                        if now < round_model.betting_closes_at:
                            raise OracleConnectionError(
                                f"Cannot submit result before local betting end: {round_model.betting_closes_at.isoformat()} (now: {now.isoformat()})"
                            )

                logger.info(
                    "submitting_result_onchain",
                    extra={
                        "round_id": str(round_model.id),
                        "round_number": int(round_model.round_number),
                        "local_betting_closes_at": str(round_model.betting_closes_at),
                        "onchain_betting_end": betting_end,
                        "oracle_account": self.oracle_client.account.address if self.oracle_client.account else None,
                    },
                )

                try:
                    tx_hash = await asyncio.to_thread(
                        self.oracle_client.send_transaction,
                        "submitResult",
                        int(round_model.round_number),
                        int(result),
                    )
                except OracleConnectionError as exc:
                    raise OracleConnectionError(
                        f"Contract rejected submitResult simulation for round {round_model.round_number}: {exc}"
                    ) from exc
                round_model.settlement_tx_hash = tx_hash
                round_model.settlement_status = SettlementStatus.PENDING.value
                await self.round_repository.update(round_model)

                if transaction is None:
                    transaction = await self.round_transaction_repository.create(
                        round_model.id,
                        int(round_model.round_number),
                        RoundTransactionType.SUBMIT_RESULT.value,
                        tx_hash,
                    )
                else:
                    await self.round_transaction_repository.update_status(
                        transaction,
                        RoundTransactionStatus.PENDING.value,
                        None,
                        tx_hash,
                    )

                await self._confirm_submit_result_transaction(round_model, transaction, result)
                round_model.settlement_status = SettlementStatus.CONFIRMED.value
                round_model.status = RoundStatus.SETTLED
                round_model.settlement_confirmed_at = datetime.now(timezone.utc)
                await self.round_repository.update(round_model)
                return round_model
            except OracleConnectionError as exc:
                round_model.settlement_status = SettlementStatus.FAILED.value
                await self.round_repository.update(round_model)
                if transaction is not None:
                    await self.round_transaction_repository.update_status(
                        transaction,
                        RoundTransactionStatus.FAILED.value,
                        str(exc),
                    )
                raise

        raise OracleConnectionError("Unable to settle round due to existing settlement state")

    async def _confirm_submit_result_transaction(
        self,
        round_model: Round,
        transaction: "app.models.round_transaction.RoundTransaction",
        expected_result: int,
    ) -> None:
        if self.oracle_client is None:
            raise OracleConnectionError("Oracle client is not configured")

        try:
            receipt = await asyncio.to_thread(
                self.oracle_client.wait_for_transaction_receipt,
                transaction.transaction_hash,
            )
        except OracleConnectionError as exc:
            await self.round_transaction_repository.update_status(
                transaction,
                RoundTransactionStatus.FAILED.value,
                str(exc),
            )
            raise

        status = getattr(receipt, "status", None) or receipt.get("status")
        if status != 1:
            await self.round_transaction_repository.update_status(
                transaction,
                RoundTransactionStatus.FAILED.value,
                f"Transaction reverted or failed with status={status}",
            )
            raise OracleConnectionError(
                f"Result submission transaction {transaction.transaction_hash} failed with status={status}"
            )

        await self._verify_onchain_settlement(
            int(round_model.round_number),
            expected_result,
            transaction.transaction_hash,
        )

        await self.round_transaction_repository.update_status(
            transaction,
            RoundTransactionStatus.CONFIRMED.value,
        )
        logger.info(
            "result_submitted_on_chain",
            extra={
                "round_id": str(round_model.id),
                "round_number": int(round_model.round_number),
                "result": int(expected_result),
                "tx_hash": transaction.transaction_hash,
            },
        )

        await self._reconcile_onchain_financials(round_model, expected_result)

    async def live_round(self, round_id: UUID) -> Round:
        round_model = await self.round_repository.get_by_id(round_id)
        if round_model is None:
            raise ValueError("Round not found")
        if round_model.status != RoundStatus.LOCKED:
            raise ValueError("Round is not locked")
        round_model.status = RoundStatus.LIVE
        await self.round_repository.update(round_model)
        logger.info("round_live", extra={"round_id": str(round_model.id)})
        return round_model
    
    async def _verify_onchain_settlement(self, round_number: int, expected_result: int, tx_hash: str | None = None) -> None:
        if self.oracle_client is None:
            raise OracleConnectionError("Oracle client is not configured")

        if not await asyncio.to_thread(self.oracle_client.round_exists, round_number):
            raise OracleConnectionError(f"Round {round_number} does not exist on-chain")

        onchain_status = await asyncio.to_thread(self.oracle_client.get_round_status, round_number)
        if onchain_status != 3:
            raise OracleConnectionError(f"On-chain round status is {onchain_status}, expected FINISHED")

        onchain_result = await asyncio.to_thread(self.oracle_client.get_final_vehicle_count, round_number)
        if onchain_result is None or onchain_result != expected_result:
            raise OracleConnectionError(
                f"On-chain final vehicle count is {onchain_result}, expected {expected_result}"
            )

        if tx_hash is not None:
            receipt = await asyncio.to_thread(self.oracle_client.get_transaction_receipt, tx_hash)
            if receipt is not None:
                event = self.oracle_client.decode_round_settled_event(receipt)
                if event is None:
                    logger.warning(
                        "could_not_decode_settlement_event",
                        extra={"round_number": round_number, "tx_hash": tx_hash},
                    )
                else:
                    if event["round_number"] != round_number or event["final_vehicle_count"] != expected_result:
                        raise OracleConnectionError("Settlement event payload does not match expected round or result")

    async def _reconcile_onchain_financials(self, round_model: Round, expected_result: int | None = None) -> None:
        if self.oracle_client is None or round_model.round_number is None:
            return

        round_model.reconciliation_started_at = round_model.reconciliation_started_at or datetime.now(timezone.utc)
        round_model.reconciliation_status = FinancialReconciliationStatus.PENDING.value
        await self.round_repository.update(round_model)

        try:
            round_data = await asyncio.to_thread(self.oracle_client.get_round_struct, int(round_model.round_number))
            print(f"Round {round_model.round_number} on-chain struct: {round_data}")
            pools = await asyncio.to_thread(self.oracle_client.get_round_pools, int(round_model.round_number))
            print(f"Round {round_model.round_number} on-chain pools: {pools}")
            contract_fee_bps = await asyncio.to_thread(self.oracle_client.get_protocol_fee_bps)
            print(f"Round {round_model.round_number} on-chain protocol fee: {contract_fee_bps}")

            # If the struct returned on-chain doesn't match the expected ABI, fall back
            # to safer individual getters for critical numeric fields.
            if round_data.get("_abi_mismatch"):
                # Use dedicated getters when struct decoding is unreliable
                onchain_final = await asyncio.to_thread(self.oracle_client.get_final_vehicle_count, int(round_model.round_number))
                onchain_status = await asyncio.to_thread(self.oracle_client.get_round_status, int(round_model.round_number))
                # pools and protocol fee already fetched above
                round_model.onchain_final_vehicle_count = int(onchain_final) if onchain_final is not None else -1
                round_model.onchain_status = int(onchain_status)
                round_model.onchain_protocol_fee_bps = int(contract_fee_bps)
                # Set winning side conservatively from pools if available
                try:
                    round_model.onchain_total_pool = int(pools[2])
                    round_model.onchain_over_pool = int(pools[0])
                    round_model.onchain_under_pool = int(pools[1])
                    round_model.onchain_winner_pool = int(pools[3])
                    round_model.onchain_loser_pool = int(pools[4])
                    round_model.onchain_treasury_fee = int(pools[5])
                except Exception:
                    # leave defaults if pools parsing failed
                    pass
            else:
                # The contract-wide `protocolFeeBps` is authoritative. Some on-chain
                # round struct decoders may omit `protocolFeeBps`; treat missing or
                # malformed values as non-fatal and prefer the contract getter.
                rd_pf_raw = round_data.get("protocolFeeBps")
                if rd_pf_raw is None:
                    logger.warning(
                        "round_struct_missing_protocolFeeBps",
                        extra={
                            "round_number": round_model.round_number,
                            "contract_protocolFeeBps": contract_fee_bps,
                        },
                    )
                    rd_pf = int(contract_fee_bps)
                else:
                    try:
                        rd_pf = int(rd_pf_raw)
                    except Exception:
                        logger.warning(
                            "round_struct_protocolFeeBps_malformed",
                            extra={"round_number": round_model.round_number, "value": rd_pf_raw},
                        )
                        rd_pf = int(contract_fee_bps)

                if rd_pf != int(contract_fee_bps):
                    logger.warning(
                        "onchain_protocol_fee_mismatch",
                        extra={
                            "round_number": round_model.round_number,
                            "round_value": rd_pf,
                            "contract_value": int(contract_fee_bps),
                        },
                    )

                if expected_result is not None and int(round_data.get("finalVehicleCount", -1)) != expected_result:
                    raise ValueError(
                        f"On-chain final vehicle count mismatch: {round_data.get('finalVehicleCount')} expected {expected_result}"
                    )

                round_model.onchain_total_pool = int(round_data.get("totalPool", pools[2]))
                round_model.onchain_over_pool = int(pools[0])
                round_model.onchain_under_pool = int(pools[1])
                round_model.onchain_winner_pool = int(pools[3])
                round_model.onchain_loser_pool = int(pools[4])
                round_model.onchain_treasury_fee = int(pools[5])
                round_model.onchain_protocol_fee_bps = int(round_data.get("protocolFeeBps", -1))
                round_model.onchain_winning_side = int(round_data.get("winningSide", -1))
                round_model.onchain_final_vehicle_count = int(round_data.get("finalVehicleCount", -1))
                settled_at = int(round_data.get("settledAt", 0))
                round_model.onchain_settled_at = datetime.fromtimestamp(settled_at, timezone.utc) if settled_at > 0 else None
                round_model.onchain_status = int(round_data.get("status", -1))
            round_model.reconciliation_status = FinancialReconciliationStatus.SUCCESS.value
            round_model.reconciliation_error_message = None
        except Exception as exc:
            # 1. Truncate error message text to ensure safe column entry limits
            clean_error_string = str(exc)[:1000]

            round_model.reconciliation_status = FinancialReconciliationStatus.FAILED.value
            round_model.reconciliation_error_message = clean_error_string
            round_model.reconciliation_completed_at = datetime.now(timezone.utc)
            await self.round_repository.update(round_model)
            raise
        else:
            round_model.reconciliation_completed_at = datetime.now(timezone.utc)
            await self.round_repository.update(round_model)

    async def settle_round(self, round_id: UUID, result: int = 37) -> Round:
        round_model = await self.round_repository.get_by_id(round_id)
        if round_model is None:
            raise ValueError("Round not found")
        if round_model.status == RoundStatus.SETTLED:
            raise ValueError("Round already settled")
        round_model.status = RoundStatus.SETTLED
        round_model.result = result
        await self.round_repository.update(round_model)
        logger.info("round_settled", extra={"round_id": str(round_model.id), "result": result})
        return round_model

    async def finish_round(self, round_id: UUID, result: int = 37) -> Round:
        round_model = await self.round_repository.get_by_id(round_id)
        if round_model is None:
            raise ValueError("Round not found")
        if round_model.status == RoundStatus.FINISHED:
            raise ValueError("Round already finished")
        round_model.status = RoundStatus.FINISHED
        round_model.result = result
        await self.round_repository.update(round_model)
        
        # Recycle video back to READY for reuse in next round
        if round_model.video_id:
            video = await self.video_repository.get_by_id(round_model.video_id)
            if video is not None:
                await self.video_repository.update_status(video, VideoStatus.READY)
                logger.info("video_recycled", extra={"video_id": str(video.id), "round_id": str(round_model.id)})
        
        logger.info("round_finished", extra={"round_id": str(round_model.id), "result": result})
        return round_model
    
    async def get_current_round(self) -> Round | None:
        return await self.round_repository.get_current_round()
