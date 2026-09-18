from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy.exc import IntegrityError

from app.core.enums import BetStatus, RoundStatus
from app.models.bet import Bet
from app.models.player import Player
from app.repositories.bet_repository import BetRepository
from app.repositories.player_repository import PlayerRepository
from app.repositories.round_repository import RoundRepository

logger = logging.getLogger("game")


class BetService:
    def __init__(self, round_repository: RoundRepository, player_repository: PlayerRepository, bet_repository: BetRepository) -> None:
        self.round_repository = round_repository
        self.player_repository = player_repository
        self.bet_repository = bet_repository

    async def place_bet(self, wallet_address: str, prediction: int, stake: int) -> Bet:
        wallet_address = wallet_address.strip().lower()
        round_model = await self.round_repository.get_current_round()
        if round_model is None:
            raise ValueError("No active round")
        if round_model.status != RoundStatus.OPEN:
            raise ValueError("Betting is closed")

        player = await self.player_repository.get_or_create(wallet_address)
        existing = await self.bet_repository.get_by_round_and_player(round_model.id, wallet_address)
        if existing is not None:
            raise ValueError("Duplicate bet for this round")

        bet = await self.bet_repository.create(round_id=round_model.id, player_id=player.id, prediction=prediction, stake=stake)
        logger.info("bet_placed", extra={"wallet": wallet_address, "round_id": str(round_model.id), "prediction": prediction, "stake": stake})
        return bet

    async def sync_onchain_bet(
        self,
        *,
        round_id: UUID,
        wallet_address: str,
        prediction: int,
        stake: int,
        transaction_hash: str,
    ) -> Bet:
        """Persist a bet only after the route has verified its mined EVM transaction."""
        normalized_wallet = wallet_address.strip().lower()
        normalized_hash = transaction_hash.lower()

        existing_transaction = await self.bet_repository.get_by_transaction_hash(normalized_hash)
        if existing_transaction is not None:
            if (
                existing_transaction.round_id != round_id
                or existing_transaction.prediction != prediction
                or existing_transaction.stake != stake
            ):
                raise ValueError("Transaction hash is already associated with a different bet")
            return existing_transaction

        round_model = await self.round_repository.get_by_id(round_id)
        if round_model is None:
            raise ValueError("Round not found")
        # Allow syncing of verified on-chain bets even if the round is no longer
        # in OPEN status. The on-chain verification performed by the route
        # ensures the transaction actually targeted the expected round/side.
        if round_model.round_number is None:
            raise ValueError("Round has no on-chain round number")

        player = await self.player_repository.get_or_create(normalized_wallet)
        existing_player_bet = await self.bet_repository.get_by_round_and_player(round_id, normalized_wallet)
        if existing_player_bet is not None:
            raise ValueError("Duplicate bet for this round")

        try:
            return await self.bet_repository.create(
                round_id=round_id,
                player_id=player.id,
                prediction=prediction,
                stake=stake,
                transaction_hash=normalized_hash,
                onchain_round_number=int(round_model.round_number),
            )
        except IntegrityError:
            # A concurrent retry may have won the unique transaction-hash race.
            existing_transaction = await self.bet_repository.get_by_transaction_hash(normalized_hash)
            if existing_transaction is not None and (
                existing_transaction.round_id == round_id
                and existing_transaction.prediction == prediction
                and existing_transaction.stake == stake
            ):
                return existing_transaction
            raise ValueError("Transaction hash is already associated with a different bet")

    async def get_round_bets(self, round_id: UUID) -> list[Bet]:
        return await self.bet_repository.list_by_round(round_id)

    async def get_player_bets(self, wallet_address: str) -> list[Bet]:
        return await self.bet_repository.list_by_player(wallet_address)
