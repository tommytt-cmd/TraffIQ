from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import traceback

from app.core.enums import RoundStatus
from app.events.publisher import Publisher
from app.events.schemas import (
    Heartbeat,
    ReplayStarted,
    RoundCreated,
    RoundFinished,
    RoundLocked,
    RoundStarted,
    RoundSettled,
)
from app.services.round_service import RoundService
from app.services.settlement_service import SettlementService

# optional replay integration
try:
    from app.replay.service import ReplayService
except Exception:
    ReplayService = None  # type: ignore


def _normalize_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class GameScheduler:
    def __init__(
        self,
        round_service: RoundService,
        publisher: Publisher | None = None,
        settlement_service: SettlementService | None = None,
    ) -> None:
        self.round_service = round_service
        self.publisher = publisher
        self.settlement_service = settlement_service
        self.replay_service: ReplayService | None = None

    async def tick(self) -> None:
        print("Ticker request")
        try:
            current = await self.round_service.get_current_round()
            if current is None:
                current = await self.round_service.create_round()
                
                video = None
                if current.video_id:
                    video = await self.round_service.video_repository.get_by_id(
                        current.video_id
                    )
                    result = video.vehicle_total
                    threshold = current.threshold
                print(f"Video found: {video is not None}")
                
                if self.publisher is not None:
                    created = RoundCreated(
                        event="round_created",
                        payload={
                            "round_id": str(current.id),
                            "starts_at": current.starts_at,
                            "betting_closes_at": current.betting_closes_at,
                            "threshold": threshold,
                            "location_name": (
                                    video.location_name if video else None
                                ),
                        },
                    )
                    await self.publisher.publish(created)
                    print("Round created")

            """if current is None:
                return"""

            if current.status == RoundStatus.WAITING:
                print("Ticker Round is waiting")
                try:
                    current = await self.round_service.open_round(current.id)
                except Exception as exc:
                    print(f"Failed to open round {current.id}: {exc}")
                    return

                video = None
                if current.video_id:
                    video = await self.round_service.video_repository.get_by_id(
                        current.video_id
                    )
                    result = video.vehicle_total
                    threshold = current.threshold
                print(current.round_number)
                if self.publisher is not None:
                    started = RoundStarted(
                        event="round_started",
                        payload={
                            "round_id": str(current.id),
                            "round_number": current.round_number,
                            "starts_at": current.starts_at,
                            "betting_closes_at": current.betting_closes_at,
                            "locked_ends_at": current.locked_ends_at,
                            "live_ends_at": current.live_ends_at,
                            "ends_at": current.ends_at,
                            "threshold": threshold,
                            "location_name": (
                                video.location_name if video else None
                            ),
                        },
                    )
                    await self.publisher.publish(started)
                    print(f"round started at {current.starts_at}")
                """if (video and self.replay_service is not None):
                    try:
                        await self.replay_service.start(
                            round_id=str(current.id),
                            video_id=video.id,
                            starts_at=current.starts_at,
                            video_duration_seconds=video.duration_seconds,
                        )
                        print("replay start")
                        if self.publisher is not None:
                            replay_started = ReplayStarted(
                                event="replay_started",
                                payload={
                                    "round_id": str(current.id),
                                    "video_url": video.video_url,
                                    "duration_seconds": float(
                                        video.duration_seconds
                                    ),
                                    "position_seconds": 0.0,
                                    "location_name": video.location_name,
                                },
                            )
                            print(video.video_url)
                            await self.publisher.publish(replay_started)
                    except Exception as exc:
                        print(f"Replay start failed: {exc}")"""
                return

            if current.status == RoundStatus.OPEN:
                print("Ticker Round is open")
                if current.betting_closes_at is not None:
                    now = datetime.now(timezone.utc).replace(microsecond=0)
                    closes_at = _normalize_datetime(current.betting_closes_at)
                    if closes_at is not None:
                        closes_at = closes_at.replace(microsecond=0)
                    if closes_at is not None and now >= closes_at:
                        print("Betting closes at reached, locking round on-chain")
                        try:
                            current = await self.round_service.lock_round(current.id)
                        except Exception as exc:
                            print(f"Failed to lock round {current.id}: {exc}")
                            traceback.print_exc()
                            return

                        if self.publisher is not None:
                            locked = RoundLocked(event="round_locked", payload={"round_id": str(current.id)})
                            await self.publisher.publish(locked)
                            print("Round is locked")
                return

            if current.status == RoundStatus.LOCKED:
                print("Ticker ROund lock")
                if current.locked_ends_at is not None:
                    now = datetime.now(timezone.utc).replace(microsecond=0)
                    ends_at = _normalize_datetime(current.locked_ends_at)
                    if ends_at is not None:
                        ends_at = ends_at.replace(microsecond=0)
                    if ends_at is not None and now >= ends_at:
                        # Keep the updated model. Publishing round_locked below after
                        # this transition used to make clients oscillate between
                        # LOCKED and LIVE and clear their video source.
                        current = await self.round_service.live_round(current.id)
                        print("Round is live")
                        video = None
                        if current.video_id:
                            video = await self.round_service.video_repository.get_by_id(current.video_id)

                        if video is None:
                            return
                    

                        
                        if (video and self.replay_service is not None):
                            try:
                                await self.replay_service.start(
                                    round_id=str(current.id),
                                    video_id=video.id,
                                    starts_at=current.starts_at,
                                    video_duration_seconds=video.duration_seconds,
                                )
                                state = self.replay_service.get_state(str(current.id))
                                timeline_events: list[dict[str, int]] = []
                                if state is not None:
                                    timeline_events = [
                                        {
                                            "timestamp_ms": event.timestamp_ms,
                                            "cumulative_count": event.cumulative_count,
                                        }
                                        for event in state.events
                                    ]
                                print("replay start")
                                if self.publisher is not None:
                                    starts_at = _normalize_datetime(current.locked_ends_at)
                                    replay_started = ReplayStarted(
                                        event="replay_started",
                                        payload={
                                            "round_id": str(current.id),
                                            "video_url": video.video_url,
                                            "duration_seconds": float(
                                                video.duration_seconds
                                            ),
                                            "position_seconds": (now - starts_at).total_seconds(),
                                            "timeline_events": timeline_events,
                                            "location_name": video.location_name,
                                        },
                                    )
                                    await self.publisher.publish(replay_started)
                            except Exception as exc:
                                print(f"Replay start failed: {exc}")
                        # The transition has been announced by replay_started. Do
                        # not emit a stale round_locked event after becoming LIVE.
                        return
        
            if current.status == RoundStatus.LIVE:
                print("Round is live")
                if current.ends_at is not None:
                    now = datetime.now(timezone.utc).replace(microsecond=0)
                    ends_at = _normalize_datetime(current.live_ends_at)
                    if ends_at is not None:
                        ends_at = ends_at.replace(microsecond=0)
                    if ends_at is not None and now >= ends_at:
                        # Submit result before finishing
                        print("Round live ends at reached, submitting result and finishing round on-chain")
                        if current.video_id:
                            try:
                                video = await self.round_service.video_repository.get_by_id(
                                    current.video_id
                                )
                                if video is not None:
                                    result = video.vehicle_total
                                    threshold = current.threshold
                                    winner = (
                                        "OVER"
                                        if result > threshold
                                        else "UNDER"
                                    )
                                    current = await self.round_service.submit_result(current.id, result)
                                    if self.publisher is not None:
                                        settled = RoundSettled(
                                            event="round_settled",
                                            payload={
                                                "round_id": str(current.id),
                                                "result": result,
                                                "winner": winner,
                                            },
                                        )
                                        await self.publisher.publish(settled)
                                    print(f"Result submitted: {result}")
                                    return
                            except Exception as exc:
                                print(f"Failed to submit result for round {current.id}: {exc}")
                                traceback.print_exc()
                                return
                    video = None
                    if current.video_id:
                        video = await self.round_service.video_repository.get_by_id(
                            current.video_id
                        )

                    if video is None:
                        return
                

                    
                    if (video and self.replay_service is not None):
                        try:
                            await self.replay_service.start(
                                round_id=str(current.id),
                                video_id=video.id,
                                starts_at=current.starts_at,
                                video_duration_seconds=video.duration_seconds,
                            )
                            state = self.replay_service.get_state(str(current.id))
                            timeline_events: list[dict[str, int]] = []
                            if state is not None:
                                timeline_events = [
                                    {
                                        "timestamp_ms": event.timestamp_ms,
                                        "cumulative_count": event.cumulative_count,
                                    }
                                    for event in state.events
                                ]
                            print("replay start")
                            if self.publisher is not None:
                                starts_at = _normalize_datetime(current.locked_ends_at)
                                replay_started = ReplayStarted(
                                    event="replay_started",
                                    payload={
                                        "round_id": str(current.id),
                                        "video_url": video.video_url,
                                        "duration_seconds": float(
                                            video.duration_seconds
                                        ),
                                        "position_seconds": (now - starts_at).total_seconds(),
                                        "timeline_events": timeline_events,
                                        "location_name": video.location_name,
                                    },
                                )
                                await self.publisher.publish(replay_started)
                        except Exception as exc:
                            print(f"Replay start failed: {exc}")
                
                
            if current.status in (RoundStatus.SETTLED, RoundStatus.FINISHED):
                print("Ticker Round SETTLED")
                try:
                    result = current.result
                    winner = None
                    if current.video_id:
                        video = await self.round_service.video_repository.get_by_id(
                            current.video_id
                        )
                        if video is not None:
                            result = video.vehicle_total if result is None else result
                            threshold = current.threshold
                            winner = "OVER" if result > threshold else "UNDER"

                    # Reconcile pending bets on every tick while the round is
                    # settled/finished. This also repairs records created
                    # before the scheduler was wired to SettlementService.
                    if self.settlement_service is not None and winner is not None:
                        await self.settlement_service.settle_round(
                            current.id,
                            winner_side=1 if winner == "OVER" else 0,
                        )

                    if current.ends_at is not None:
                        now = datetime.now(timezone.utc).replace(microsecond=0)
                        ends_at = _normalize_datetime(current.ends_at)
                        if ends_at is not None:
                            ends_at = ends_at.replace(microsecond=0)
                        if ends_at is not None and now >= ends_at:
                            await self.round_service.finish_round(current.id)
                            if self.publisher is not None:
                                finished = RoundFinished(
                                    event="round_finished",
                                    payload={
                                            "round_id": str(current.id)
                                        },
                                )
                                await self.publisher.publish(finished)
                                print("Round ended")
                                return
                    
                        if self.publisher is not None:
                            settled = RoundSettled(
                                event="round_settled",
                                payload={
                                        "round_id": str(current.id),
                                        "result": result,
                                        "winner": winner,
                                    },
                            )
                            await self.publisher.publish(settled)
                            print("Round settled")
                except Exception as exc:
                    print(f"Settling failed: {exc}")
        except Exception as e:
            print(f"Scheduler failed: {e}")
            traceback.print_exc()
