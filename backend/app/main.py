from fastapi import FastAPI
import asyncio
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.game import router as game_router
from app.api.routes.rounds import router as rounds_router
from app.api.routes.videos import router as videos_router
from app.api.routes.upload import router as upload_router
from app.api.routes.jobs import router as jobs_router
from app.api.routes.health import router as health_router
from app.api.routes.wallet import router as wallet_router
from app.api.routes.profile import router as profile_router
from app.api.routes.me import router as me_router
from app.api.routes.stocks import router as stocks_router
from app.domains.fairness.router import router as fairness_router
from app.domains.monitoring.router import router as monitoring_router
from app.infrastructure.observability.logger import configure_logging
from app.infrastructure.observability.middleware import ObservabilityMiddleware
from app.broadcaster.broadcaster import Broadcaster
from app.database.session import init_db
from app.oracle import OracleClient
from app.scheduler.scheduler import GameScheduler
from app.settings import settings
from app.scheduler.timer import EventTimer
from app.services.round_service import RoundService
from app.services.settlement_service import SettlementService
from app.services.round_buyback_service import RoundBuybackService
from app.websocket.manager import manager
from app.websocket.router import router as websocket_router

# event bus / redis
from app.redis.client import RedisClient
from app.redis.dummy import DummyRedisClient
from app.events.event_bus import EventBus
from app.events.publisher import Publisher
from app.events.subscriber import Subscriber
from app.events.handlers import register_broadcaster_handlers
from app.events.monitor import HeartbeatPublisher, ServerStatusPublisher
from app.events.registry import registry
from app.replay.service import ReplayService
from app.replay.scheduler import ReplayScheduler

from app.repositories.timeline_repository import TimelineRepository


#configure_logging()
app = FastAPI(title="RushHour Traffic Prediction Game", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.add_middleware(ObservabilityMiddleware)
app.include_router(rounds_router)
app.include_router(videos_router)
app.include_router(upload_router)
app.include_router(game_router)
app.include_router(wallet_router)
app.include_router(profile_router)
app.include_router(me_router)
app.include_router(stocks_router)
app.include_router(fairness_router)
app.include_router(monitoring_router)
app.include_router(websocket_router)
app.include_router(health_router)
app.include_router(jobs_router)

broadcaster = Broadcaster(manager)


@app.on_event("startup")
async def startup_event() -> None:
    print("startup: before init_db")
    await init_db()
    print("startup: after init_db")
    app.state.stock_vault_indexer = None
    if settings.RPC_URL and settings.STOCK_VAULT_ADDRESS:
        # Read-only indexing; this never has access to a user signing key.
        from app.database.session import SessionLocal as StockSessionLocal
        from app.services.stock_vault_indexer import StockVaultIndexer

        # prefer a dedicated WS URL for vault subscriptions, fall back to RPC_URL
        vault_ws = settings.VAULT_WS_URL or settings.RPC_URL
        # parse optional headers JSON
        import json as _json
        ws_headers = None
        if getattr(settings, "VAULT_WS_HEADERS", ""):
            try:
                ws_headers = _json.loads(settings.VAULT_WS_HEADERS)
            except Exception:
                ws_headers = None

        indexer = StockVaultIndexer(
            StockSessionLocal,
            vault_ws,
            settings.STOCK_VAULT_ADDRESS,
            ws_headers=ws_headers,
        )
        # Start websocket listener in background so startup is non-blocking
        print("startup: starting stock vault websocket listener")
        task = asyncio.create_task(indexer.listen_forever())
        app.state.stock_vault_task = task
        app.state.stock_vault_indexer = indexer
    from app.repositories.round_repository import RoundRepository
    from app.repositories.round_transaction_repository import RoundTransactionRepository
    from app.repositories.video_repository import VideoRepository
    from app.repositories.timeline_repository import TimelineRepository
    from app.database.session import SessionLocal

    # init DB services
    session = SessionLocal()
    round_repository = RoundRepository(session)
    round_transaction_repository = RoundTransactionRepository(session)
    video_repository = VideoRepository(session)
    timeline_repository = TimelineRepository(session)

    # setup Redis client (with dummy fallback)
    print("startup: setup redis client")
    redis_client = RedisClient()
    try:
        print("startup: attempting redis.connect")
        await redis_client.connect()
        print("startup: redis.connect succeeded")
    except Exception:
        print("startup: redis.connect failed, using DummyRedisClient")
        redis_client = DummyRedisClient()
        await redis_client.connect()
        print("startup: dummy redis connected")

    # event bus and publisher
    event_bus = EventBus(redis_client, registry)
    publisher = Publisher(event_bus)

    # subscriber and broadcaster handlers
    subscriber = Subscriber(redis_client, event_bus)
    register_broadcaster_handlers(broadcaster, subscriber)
    if getattr(redis_client, "connected", False):
        print("startup: starting subscriber")
        await subscriber.start()
        print("startup: subscriber started")

    # monitoring publishers
    heartbeat = HeartbeatPublisher(publisher)
    server_status = ServerStatusPublisher(publisher, redis_client)
    print("startup: starting heartbeat publisher")
    await heartbeat.start()
    print("startup: heartbeat started")
    print("startup: starting server status publisher")
    await server_status.start()
    print("startup: server status started")

    # setup oracle client if configured
    app.state.oracle_client = None
    oracle_client = None
    if settings.ORACLE_ENABLED:
        if not settings.ORACLE_PRIVATE_KEY:
            raise RuntimeError("ORACLE_ENABLED is true but ORACLE_PRIVATE_KEY is not configured")
        oracle_client = OracleClient(
            settings.ORACLE_RPC_URL,
            settings.ORACLE_CONTRACT_ADDRESS,
            contract_json_path=settings.ORACLE_CONTRACT_JSON_PATH,
            private_key=settings.ORACLE_PRIVATE_KEY,
        )
        available = {
            item.get("name")
            for item in oracle_client.abi
            if item.get("type") == "function" and isinstance(item.get("name"), str)
        }
        if not {"createRound", "protocolFeeBps"}.issubset(available):
            raise RuntimeError("Oracle ABI is missing required createRound/protocolFeeBps methods")
        if not available.intersection({"oracle", "resultOracle"}):
            raise RuntimeError("Oracle ABI is missing the oracle getter required for signer validation")
        if not oracle_client.is_connected():
            raise RuntimeError("Oracle RPC is not connected")
        if settings.ORACLE_CHAIN_ID and oracle_client.get_chain_id() != settings.ORACLE_CHAIN_ID:
            raise RuntimeError(
                f"Oracle RPC chain ID does not match ORACLE_CHAIN_ID={settings.ORACLE_CHAIN_ID}"
            )
        contract_oracle_address = oracle_client.get_onchain_oracle()
        signer_address = oracle_client.account.address if oracle_client.account is not None else None
        if signer_address is None or signer_address.lower() != contract_oracle_address.lower():
            raise RuntimeError(
                "ORACLE_PRIVATE_KEY does not match the deployed contract oracle address. "
                f"Signer={signer_address}, contract oracle={contract_oracle_address}. "
                "Use a private key for the current contract oracle or update the contract oracle role."
            )
        app.state.oracle_client = oracle_client

    # scheduler and timers
    round_service = RoundService(
        round_repository,
        video_repository,
        oracle_client=oracle_client,
        round_transaction_repository=round_transaction_repository,
    )
    from app.repositories.bet_repository import BetRepository
    settlement_service = SettlementService(
        round_repository,
        BetRepository(session),
    )
    buyback_service = None
    if settings.BUYBACK_ENABLED:
        buyback_service = RoundBuybackService(round_repository, oracle_client)
    scheduler = GameScheduler(
        round_service,
        publisher=publisher,
        settlement_service=settlement_service,
        buyback_service=buyback_service,
    )
    # wire replay service and scheduler
    replay_srv = ReplayService(
        SessionLocal,
        timeline_repository,
    )
    try:
        scheduler.replay_service = replay_srv
        replay_scheduler = ReplayScheduler(replay_srv, publisher=publisher)
        print("startup: starting replay scheduler")
        await replay_scheduler.start()
        print("startup: replay scheduler started")
    except Exception as exc:
        replay_scheduler = None
        print(f"Replay Scheduler: {exc}")

    timer = EventTimer(scheduler=scheduler, publisher=publisher)
    print("startup: starting event timer")
    await timer.start()
    print("startup: event timer started")

    # store for shutdown
    app.state.redis_client = redis_client
    app.state.subscriber = subscriber
    app.state.heartbeat = heartbeat
    app.state.server_status = server_status
    app.state.replay_scheduler = replay_scheduler
    app.state.replay_service = replay_srv
    app.state.publisher = publisher
    app.state.db_session = session


@app.on_event("shutdown")
async def shutdown_event() -> None:
    # stop background tasks and disconnect redis
    subscriber = getattr(app.state, "subscriber", None)
    if subscriber is not None:
        try:
            await subscriber.stop()
        except Exception:
            pass

    hb = getattr(app.state, "heartbeat", None)
    if hb is not None:
        try:
            await hb.stop()
        except Exception:
            pass

    ss = getattr(app.state, "server_status", None)
    if ss is not None:
        try:
            await ss.stop()
        except Exception:
            pass

    rs = getattr(app.state, "replay_scheduler", None)
    if rs is not None:
        try:
            await rs.stop()
        except Exception:
            pass

    db_session = getattr(app.state, "db_session", None)
    if db_session is not None:
        try:
            await db_session.close()
        except Exception:
            pass

    rc = getattr(app.state, "redis_client", None)
    if rc is not None:
        try:
            await rc.disconnect()
        except Exception:
            pass
    # stop stock vault listener if running
    sv_task = getattr(app.state, "stock_vault_task", None)
    sv_indexer = getattr(app.state, "stock_vault_indexer", None)
    if sv_task is not None:
        try:
            sv_task.cancel()
            try:
                await sv_task
            except asyncio.CancelledError:
                pass
        except Exception:
            pass
    if sv_indexer is not None:
        try:
            await sv_indexer.stop()
        except Exception:
            pass
