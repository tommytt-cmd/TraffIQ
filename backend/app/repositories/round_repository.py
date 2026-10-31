from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.enums import RoundStatus
from app.models.round import Round


class RoundRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(self) -> Round:
        round_model = Round(status=RoundStatus.WAITING)
        self.session.add(round_model)
        await self.session.commit()
        await self.session.refresh(round_model)

        if round_model.round_number is None:
            result = await self.session.execute(select(func.max(Round.round_number)))
            max_round_number = result.scalar_one_or_none() or 0
            round_model.round_number = int(max_round_number) + 1
            self.session.add(round_model)
            await self.session.commit()
            await self.session.refresh(round_model)

        return round_model

    async def get_by_id(self, round_id: UUID) -> Round | None:
        result = await self.session.execute(select(Round).where(Round.id == round_id))
        return result.scalar_one_or_none()

    async def get_by_id_for_update(self, round_id: UUID) -> Round | None:
        result = await self.session.execute(
            select(Round).where(Round.id == round_id).with_for_update()
        )
        return result.scalar_one_or_none()

    async def list_by_ids(self, round_ids: set[UUID]) -> list[Round]:
        if not round_ids:
            return []
        result = await self.session.execute(select(Round).where(Round.id.in_(round_ids)))
        return list(result.scalars().all())

    async def get_current_round(self) -> Round | None:
        result = await self.session.execute(
            select(Round)
            .where(Round.status != RoundStatus.FINISHED.value)
            .order_by(Round.created_at.desc())
            .limit(1)
        )

        return result.scalar_one_or_none()

    async def update(self, round_model: Round) -> Round:
        self.session.add(round_model)
        await self.session.commit()
        await self.session.refresh(round_model)
        return round_model

    async def list(self) -> list[Round]:
        result = await self.session.execute(select(Round).order_by(Round.created_at.desc()))
        return list(result.scalars().all())

    async def list_history(self, limit: int = 10, offset: int = 0) -> list[Round]:
        result = await self.session.execute(
            select(Round)
            .where(Round.status.in_([RoundStatus.SETTLED.value, RoundStatus.FINISHED.value]))
            .order_by(Round.round_number.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(result.scalars().all())

    async def count_history(self) -> int:
        result = await self.session.execute(
            select(func.count(Round.id)).where(
                Round.status.in_([RoundStatus.SETTLED.value, RoundStatus.FINISHED.value])
            )
        )
        return int(result.scalar_one())
