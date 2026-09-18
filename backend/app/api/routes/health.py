from __future__ import annotations

from fastapi import APIRouter, Request

from app.settings import settings
from app.websocket.manager import manager

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
async def health(request: Request) -> dict[str, object]:
    client = getattr(request.app.state, "redis_client", None)
    redis_ok = False
    if client is not None:
        try:
            redis_ok = await client.ping()
        except Exception:
            pass
    oracle_ok = False
    if settings.ORACLE_ENABLED:
        oracle_client = getattr(request.app.state, "oracle_client", None)
        if oracle_client is not None:
            try:
                oracle_ok = oracle_client.is_connected()
            except Exception:
                oracle_ok = False
    return {
        "status": "healthy",
        "redis": redis_ok,
        "oracle": oracle_ok,
        "uptime": 0,
        "connections": manager.count(),
    }


@router.get("/redis")
async def redis_health(request: Request) -> dict[str, object]:
    client = getattr(request.app.state, "redis_client", None)
    return {
        "status": "healthy",
        "redis": await client.ping() if client is not None else False,
    }


@router.get("/events")
async def events_health(request: Request) -> dict[str, object]:
    client = getattr(request.app.state, "redis_client", None)
    return {
        "status": "healthy",
        "redis": await client.ping() if client is not None else False,
        "channels": ["game_events", "timer_events", "vehicle_events", "processing_events", "admin_events", "server_events", "heartbeat_events"],
    }


@router.get("/stock-vault")
async def stock_vault_health(request: Request) -> dict[str, object]:
    """Report StockVault websocket listener health.

    Returns connection status, whether the background task is running, and
    the last processed block (if available).
    """
    indexer = getattr(request.app.state, "stock_vault_indexer", None)
    task = getattr(request.app.state, "stock_vault_task", None)
    connected = False
    last_block = None
    task_running = False
    try:
        if indexer is not None:
            ws = getattr(indexer, "_ws", None)
            if ws is not None:
                connected = not getattr(ws, "closed", False)
            last_block = getattr(indexer, "last_processed_block", None)
        if task is not None:
            task_running = not task.done()
    except Exception:
        pass

    return {
        "status": "healthy",
        "connected": connected,
        "task_running": task_running,
        "last_processed_block": last_block,
    }
