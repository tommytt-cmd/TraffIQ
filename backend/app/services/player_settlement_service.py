from __future__ import annotations

import asyncio
import logging
from uuid import UUID

from app.oracle.client import OracleClient
from app.repositories.bet_repository import BetRepository
from app.repositories.player_repository import PlayerRepository
from app.repositories.player_settlement_repository import PlayerSettlementRepository
from app.repositories.round_repository import RoundRepository
from app.models.player_settlement import PlayerSettlement
from app.events.publisher import Publisher
from app.events.schemas import PlayerSettlementUpdated, PlayerSettlementUpdatedPayload

logger = logging.getLogger("game")


class PlayerSettlementService:
    def __init__(
        self,
        round_repository: RoundRepository,
        player_repository: PlayerRepository,
        bet_repository: BetRepository,
        player_settlement_repository: PlayerSettlementRepository,
        oracle_client: OracleClient | None = None,
        publisher: Publisher | None = None,
    ) -> None:
        self.round_repository = round_repository
        self.player_repository = player_repository
        self.bet_repository = bet_repository
        self.player_settlement_repository = player_settlement_repository
        self.oracle_client = oracle_client
        self.publisher = publisher

    async def get_player_settlement(self, round_id: UUID, wallet_address: str) -> PlayerSettlement:
        settlement = await self.sync_player_settlement(round_id, wallet_address)
        return settlement

    async def sync_round_settlements(self, round_id: UUID) -> list[PlayerSettlement]:
        round_model = await self.round_repository.get_by_id(round_id)
        if round_model is None:
            raise ValueError("Round not found")

        wallet_addresses: set[str] = set()
        bets = await self.bet_repository.list_by_round(round_id)
        for bet in bets:
            if bet.player_id is not None:
                player = await self.player_repository.get_by_id(bet.player_id)
                if player is not None:
                    wallet_addresses.add(player.wallet_address)

        wallet_addresses = {wallet for wallet in wallet_addresses if wallet}

        settlements: list[PlayerSettlement] = []
        for wallet in wallet_addresses:
            try:
                settlement = await self.sync_player_settlement(round_id, wallet)
                settlements.append(settlement)
            except Exception as exc:
                logger.warning("player_settlement_sync_error", extra={"round_id": str(round_id), "wallet": wallet, "error": str(exc)})

        return settlements

    async def sync_player_settlement(self, round_id: UUID, wallet_address: str) -> PlayerSettlement:
        normalized_wallet = wallet_address.strip().lower()
        round_model = await self.round_repository.get_by_id(round_id)
        if round_model is None:
            raise ValueError("Round not found")

        player = await self.player_repository.get_by_wallet(normalized_wallet)
        bet = await self.bet_repository.get_by_round_and_player(round_id, normalized_wallet)

        claim_status = None
        claimable_eth = None
        claimable_reward = 0
        pending_eth = None
        rush_claimed = None
        has_claimed = False
        over_amount = None
        under_amount = None

        if self.oracle_client is not None and round_model.round_number is not None:
            pending_eth = await asyncio.to_thread(self.oracle_client.get_pending_reward, int(round_model.round_number), normalized_wallet)
            has_claimed = await asyncio.to_thread(self.oracle_client.has_claimed, int(round_model.round_number), normalized_wallet)
            claimable_eth = 0 if has_claimed else pending_eth
            claim_status = "CLAIMED" if has_claimed else "AVAILABLE" if pending_eth > 0 else "NOT_WINNER"
            rush_claimed = None
            over_amount, under_amount = await asyncio.to_thread(self.oracle_client.get_user_bet, int(round_model.round_number), normalized_wallet)

        bet_prediction = bet.prediction if bet is not None else None
        bet_stake = bet.stake if bet is not None else None
        bet_status = bet.status.value if bet is not None else None
        is_winner = None
        if bet is not None:
            # Keep the settlement API aligned with the status already persisted
            # by SettlementService instead of independently recalculating it.
            if bet.status.value == "WON":
                is_winner = True
            elif bet.status.value == "LOST":
                is_winner = False

        settlement = PlayerSettlement(
            round_id=round_id,
            player_id=player.id if player is not None else None,
            wallet_address=normalized_wallet,
            bet_prediction=bet_prediction,
            bet_stake=bet_stake,
            bet_status=bet_status,
            over_amount=over_amount,
            under_amount=under_amount,
            is_winner=is_winner,
            claim_status=claim_status,
            claimable_eth=claimable_eth,
            claimable_reward=claimable_reward,
            pending_eth=pending_eth,
            rush_claimed=rush_claimed,
            has_claimed=has_claimed,
        )

        settlement = await self.player_settlement_repository.create_or_update(settlement)
        await self._publish_player_settlement_updated(settlement)
        return settlement

    async def _publish_player_settlement_updated(self, settlement: PlayerSettlement) -> None:
        if self.publisher is None:
            return

        try:
            event = PlayerSettlementUpdated(
                event="player_settlement_updated",
                payload=PlayerSettlementUpdatedPayload(
                    round_id=str(settlement.round_id),
                    wallet_address=settlement.wallet_address,
                    bet_prediction=settlement.bet_prediction,
                    bet_stake=settlement.bet_stake,
                    bet_status=settlement.bet_status,
                    over_amount=settlement.over_amount,
                    under_amount=settlement.under_amount,
                    is_winner=settlement.is_winner,
                    claim_status=settlement.claim_status,
                    claimable_eth=settlement.claimable_eth,
                    claimable_reward=settlement.claimable_reward,
                    pending_eth=settlement.pending_eth,
                    rush_claimed=settlement.rush_claimed,
                    has_claimed=settlement.has_claimed,
                ),
            )
            await self.publisher.publish(event)
        except Exception as exc:
            logger.exception("failed_to_publish_player_settlement_updated", extra={"error": str(exc), "wallet": settlement.wallet_address})
