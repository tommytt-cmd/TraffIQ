import os
from collections.abc import AsyncGenerator
from typing import AsyncIterator

from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy import text

from app.database.base import Base
from app.domains.security import audit, commitment, seed_manager  # noqa: F401
from app.models import bet, player, round as round_model, video, wallet
# ensure replay_event model is imported so metadata.create_all creates the table
from app.models import replay_event  # noqa: F401
from app.models import round_transaction  # noqa: F401
from app.models import player_settlement  # noqa: F401
from app.models import stock  # noqa: F401

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./rushhour.db")
engine = create_async_engine(DATABASE_URL, echo=False)
SessionLocal = async_sessionmaker(bind=engine, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        """if conn.dialect.name == "postgresql":
            # create_all does not alter an already-existing INT4 column.
            await conn.execute(text("ALTER TABLE bets ALTER COLUMN stake TYPE BIGINT"))
            await conn.execute(text("ALTER TABLE rounds ADD COLUMN IF NOT EXISTS threshold BIGINT"))
            await conn.execute(text("ALTER TABLE bets ADD COLUMN IF NOT EXISTS transaction_hash VARCHAR(66)"))
            await conn.execute(text("ALTER TABLE bets ADD COLUMN IF NOT EXISTS onchain_round_number BIGINT"))
            for statement in [
                "ALTER TABLE rounds ADD COLUMN IF NOT EXISTS buyback_status VARCHAR(255) NOT NULL DEFAULT 'PENDING'",
                "ALTER TABLE rounds ADD COLUMN IF NOT EXISTS buyback_allocation_wei BIGINT",
                "ALTER TABLE rounds ADD COLUMN IF NOT EXISTS buyback_execution_tx_hash VARCHAR(66)",
                "ALTER TABLE rounds ADD COLUMN IF NOT EXISTS buyback_finalization_tx_hash VARCHAR(66)",
                "ALTER TABLE rounds ADD COLUMN IF NOT EXISTS buyback_error_message VARCHAR(1024)",
                "ALTER TABLE rounds ADD COLUMN IF NOT EXISTS buyback_attempts BIGINT NOT NULL DEFAULT 0",
                "ALTER TABLE rounds ADD COLUMN IF NOT EXISTS buyback_confirmed_at TIMESTAMP WITH TIME ZONE",
            ]:
                await conn.execute(text(statement))
        else:
            for statement in [
                "ALTER TABLE bets ADD COLUMN transaction_hash VARCHAR(66)",
                "ALTER TABLE bets ADD COLUMN onchain_round_number BIGINT",
                "ALTER TABLE rounds ADD COLUMN buyback_status VARCHAR(255) NOT NULL DEFAULT 'PENDING'",
                "ALTER TABLE rounds ADD COLUMN buyback_allocation_wei BIGINT",
                "ALTER TABLE rounds ADD COLUMN buyback_execution_tx_hash VARCHAR(66)",
                "ALTER TABLE rounds ADD COLUMN buyback_finalization_tx_hash VARCHAR(66)",
                "ALTER TABLE rounds ADD COLUMN buyback_error_message VARCHAR(1024)",
                "ALTER TABLE rounds ADD COLUMN buyback_attempts BIGINT NOT NULL DEFAULT 0",
                "ALTER TABLE rounds ADD COLUMN buyback_confirmed_at DATETIME",
            ]:
                try:
                    await conn.execute(text(statement))
                except Exception:
                    pass
        try:
            await conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_bets_transaction_hash "
                "ON bets(transaction_hash) WHERE transaction_hash IS NOT NULL"
            ))
        except Exception:
            pass
        # Backfill optional settlement reconciliation columns if the schema exists already.
        for statement in [
            "ALTER TABLE player_settlements ADD COLUMN IF NOT EXISTS pending_eth BIGINT",
            "ALTER TABLE player_settlements ADD COLUMN IF NOT EXISTS rush_claimed BOOLEAN",
        ]:
            try:
                await conn.execute(text(statement))
            except Exception:
                pass"""


def get_db_session_factory() -> async_sessionmaker[AsyncSession]:
    return SessionLocal
