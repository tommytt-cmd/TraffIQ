from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.dependencies import get_bet_service, get_round_service
from app.services.bet_service import BetService
from app.services.round_service import RoundService
from app.settings import settings

router = APIRouter(prefix="/api/game", tags=["game-compat"])


@router.get("/room")
async def room(round_service: RoundService = Depends(get_round_service)) -> dict[str, object]:
    round_model = await round_service.get_current_round()
    if round_model is None:
        round_model = await round_service.create_round()

    video_url = None
    video_duration_seconds = None
    video_location_name = None
    threshold = round_model.threshold
    if round_model.video_id is not None:
        video = await round_service.video_repository.get_by_id(round_model.video_id)
        if video is not None:
            video_url = video.video_url
            video_duration_seconds = video.duration_seconds
            video_location_name = video.location_name

    return {
        "round": {
            "id": str(round_model.id),
            "round_number": round_model.round_number,
            "video_id": str(round_model.video_id) if round_model.video_id else None,
            "status": round_model.status,
            "starts_at": round_model.starts_at.isoformat() if round_model.starts_at else None,
            "betting_closes_at": round_model.betting_closes_at.isoformat() if round_model.betting_closes_at else None,
            "locked_ends_at": round_model.locked_ends_at.isoformat() if round_model.locked_ends_at else None,
            "live_ends_at": round_model.live_ends_at.isoformat() if round_model.live_ends_at else None,
            "ends_at": round_model.ends_at.isoformat() if round_model.ends_at else None,
            "result": round_model.result,
            "created_at": round_model.created_at.isoformat(),
        },
        "status": round_model.status,
        "countdowns": {"betting": None, "round": None},
        "threshold": threshold if threshold else None,
        "location_name": video_location_name if video_location_name else None,
        "video_url": video_url if video_url else None,
        "video_duration_seconds": video_duration_seconds if video_duration_seconds else None,
        "betting_duration_seconds": settings.BETTING_DURATION_SECONDS,
        "replay_duration_seconds": settings.LIVE_DURATION_SECONDS,
        "result_duration_seconds": settings.SETTLING_DURATION_SECONDS,
    }


@router.get("/bets", response_model=list[dict[str, object]])
async def bets(round_service: RoundService = Depends(get_round_service), bet_service: BetService = Depends(get_bet_service)) -> list[dict[str, object]]:
    current = await round_service.get_current_round()
    if current is None:
        return []
    bets = await bet_service.get_round_bets(current.id)
    return [{"prediction": bet.prediction, "stake": bet.stake} for bet in bets]


@router.get("/history")
async def history(
    limit: int = Query(default=10, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    round_service: RoundService = Depends(get_round_service),
) -> dict[str, object]:
    rounds = await round_service.round_repository.list_history(limit, offset)
    total = await round_service.round_repository.count_history()
    history: list[dict[str, object]] = []
    for round_model in rounds:
        video = await round_service.video_repository.get_by_id(round_model.video_id) if round_model.video_id else None
        final_count = video.vehicle_total if video is not None else round_model.result
        threshold = round_model.threshold
        if threshold is None and final_count is not None:
            threshold = round_service.get_single_threshold(final_count)
        if final_count is None or threshold is None:
            continue
        history.append({
            "id": str(round_model.id),
            "round_number": round_model.round_number,
            "threshold": threshold,
            "final": final_count,
            "result": "over" if final_count > threshold else "under",
        })
    return {"items": history, "total": total, "limit": limit, "offset": offset}
