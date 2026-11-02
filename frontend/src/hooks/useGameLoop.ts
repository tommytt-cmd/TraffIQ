import { useEffect, useRef, useState } from 'react';
import type { GamePhase, RecentLine, Side } from '../lib/types';

export const GAME_API_BASE = import.meta.env.VITE_GAME_API_URL ?? 'http://localhost:8000';

interface RoundResponse {
  round: {
    id: string;
    round_number: number;
    video_id: string | null;
    status: string;
    starts_at: string;
    betting_closes_at: string;
    locked_ends_at: string;
    live_ends_at: string;
    ends_at: string;
    result: number | null;
    created_at: string;
  };
  status: string;
  countdowns: {
    betting: string | null;
    round: string | null;
  };
  threshold?: number | null;
  location_name?: string | null;
  video_url?: string | null;
  video_duration_seconds?: number | null;
  betting_duration_seconds?: number | null;
  replay_duration_seconds?: number | null;
  result_duration_seconds?: number | null;
}

interface LoopSnapshot {
  isLoading: boolean;
  phase: GamePhase;
  secondsLeft: number;
  totalForPhase: number;
  vehicleCount: number;
  roundId: string;
  roundNumber: number;
  recentLines: RecentLine[];
  lastWinner: { side: Side; finalCount: number; line: number } | null;
  isLocked: boolean;
  videoUrl: string;
  playbackTime: number;
  threshold: number;
  locationName: string;
  timelineEvents: {timestamp_ms: number; cumulative_count: number}[];
  roundTimestamps: number[];
  pool: {under: number; over: number;};
}



function mapPhase(status: string): GamePhase {
  if (status === 'ACTIVE' || status === 'OPEN') return 'betting';
  if (status === 'LOCKED') return 'locked';
  if (status === 'LIVE') return 'live';
  if (status === 'SETTLED' || status === 'RESULTS' || status === 'FINISHED') return 'settle';
  return 'betting';
}

const phaseOrder: Record<GamePhase, number> = {
  betting: 0,
  locked: 1,
  live: 2,
  settle: 3,
};

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function toAbsoluteUrl(value: string): string {
  if (!value) return value;
  return value.startsWith('http') ? value : `${GAME_API_BASE}${value}`;
}

/** Keeps the UI synchronized with the authoritative FastAPI game clock. */
export function useGameLoop(): LoopSnapshot {
  const [room, setRoom] = useState<RoundResponse | null>(null);
  const [phase, setPhase] = useState<GamePhase>('betting');
  const [recentLines, setRecentLines] = useState<RecentLine[]>([]);
  const [videoUrl, setVideoUrl] = useState('');
  const [playbackTime, setPlaybackTime] = useState(0);
  const [vehicleCount, setVehicleCount] = useState(0);
  const [timelineEvents, setTimelineEvents] = useState<{timestamp_ms: number; cumulative_count: number}[]>([]);
  const [verifiedSettlementRoundId, setVerifiedSettlementRoundId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const settledRoundRef = useRef<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const activeRoundIdRef = useRef<string | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!room) return;

    if (phase === 'betting') {
      const bettingDeadline = parseTimestamp(room.round.betting_closes_at);
      if (bettingDeadline != null && now >= bettingDeadline) {
        setPhase('locked');
      }
      return;
    }

    if (phase === 'locked') {
      const lockedDeadline = parseTimestamp(room.round.locked_ends_at);
      if (lockedDeadline != null && now >= lockedDeadline) {
        setPhase('live');
      }
      return;
    }

    if (phase === 'live') {
      const liveDeadline = parseTimestamp(room.round.live_ends_at);
      if (liveDeadline != null && now >= liveDeadline) {
        setPhase('settle');
      }
    }
  }, [now, phase, room]);

  useEffect(() => {
    const syncRoom = async () => {
      try {
        const response = await fetch(`${GAME_API_BASE}/api/game/room`);
        if (!response.ok) throw new Error(`Game API returned ${response.status}`);
        const nextRoom: RoundResponse = await response.json();
        setRoom(nextRoom);
        const nextPhase = mapPhase(nextRoom.status);
        activeRoundIdRef.current = nextRoom.round.id;
        setPhase(nextPhase);
        setVerifiedSettlementRoundId(
          nextPhase === 'settle' && typeof nextRoom.round.result === 'number'
            ? nextRoom.round.id
            : null,
        );
        if (nextRoom.video_url) {
          setVideoUrl(toAbsoluteUrl(nextRoom.video_url));
        }
        if (nextRoom.status === 'SETTLED' || nextRoom.status === 'FINISHED') {
          setVehicleCount(nextRoom.round.result ?? 0);
        }
      } catch (error) {
        console.warn('Unable to reach game backend:', error);
      }
    };

    const connectSocket = () => {
      const wsUrl = `${GAME_API_BASE.replace(/^http/, 'ws')}/ws`;
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.addEventListener('message', (event) => {
        try {
          const raw = JSON.parse(event.data) as Record<string, unknown>;
          const eventName = typeof raw.event === 'string' ? raw.event : undefined;
          const payload = (raw.payload && typeof raw.payload === 'object' ? raw.payload : raw) as Record<string, unknown>;

          if (eventName === 'round_started') {
            const nextRoundId = typeof payload.round_id === 'string' ? payload.round_id : null;
            if (nextRoundId) activeRoundIdRef.current = nextRoundId;
            setRoom((current) => {
              if (!current) return current;
              return {
                ...current,
                status: 'OPEN',
                round: {
                  ...current.round,
                  // The scheduler has started a new round. Keeping the previous
                  // id/result here made the settlement screen briefly render the
                  // prior round's result while the new result was still pending.
                  id: nextRoundId ?? current.round.id,
                  status: 'OPEN',
                  round_number: payload.round_number,
                  result: null,
                  starts_at: typeof payload.starts_at === 'string' ? payload.starts_at : current.round.starts_at,
                  betting_closes_at: typeof payload.betting_closes_at === 'string' ? payload.betting_closes_at : current.round.betting_closes_at,
                  locked_ends_at: typeof payload.locked_ends_at === 'string' ? payload.locked_ends_at : current.round.betting_closes_at,
                  live_ends_at: typeof payload.live_ends_at === 'string' ? payload.live_ends_at : current.round.live_ends_at,
                  ends_at: typeof payload.ends_at === 'string' ? payload.ends_at : current.round.ends_at,

                },
                threshold: typeof payload.threshold === 'number' ? payload.threshold : current.threshold,
                location_name: typeof payload.location_name === 'string' ? payload.location_name : current.location_name,
              };
            });
            setVideoUrl('');
            setPlaybackTime(0);
            setVehicleCount(0);
            setTimelineEvents([]);
            setVerifiedSettlementRoundId(null);
            setPhase('betting');
            return;
          }

          if (eventName === 'round_locked') {
            // WebSocket messages can arrive after the local clock (or a replay
            // event) has already advanced the same round. Never regress a phase.
            setRoom((current) => {
              if (!current) return current;
              return {
                ...current,
                status: 'LOCKED',
                round: {
                  ...current.round,
                  status: 'LOCKED',
                },
              };
            });
            setPlaybackTime(0);
            setPhase((currentPhase) => (
              phaseOrder[currentPhase] > phaseOrder.locked ? currentPhase : 'locked'
            ));
            return;
          }

          if (eventName === 'replay_started') {
            const nextVideoUrl = typeof payload.video_url === 'string' ? toAbsoluteUrl(payload.video_url) : '';
            const nextTimelineEvents = Array.isArray(payload.timeline_events)
              ? payload.timeline_events
                  .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
                  .map((item) => ({
                    timestamp_ms: Number(item.timestamp_ms ?? 0),
                    cumulative_count: Number(item.cumulative_count ?? 0),
                  }))
                  .filter((item) => Number.isFinite(item.timestamp_ms) && Number.isFinite(item.cumulative_count))
              : [];

            

            if (nextVideoUrl) setVideoUrl(nextVideoUrl);
            if (nextTimelineEvents.length > 0) {
              setTimelineEvents(nextTimelineEvents);
              const positionSeconds = typeof payload.position_seconds === 'number' ? payload.position_seconds : 0;
              const positionMs = Math.round(positionSeconds * 1000);
              const currentEvent = [...nextTimelineEvents].reverse().find((event) => event.timestamp_ms <= positionMs);
              setVehicleCount(currentEvent ? currentEvent.cumulative_count : 0);
              
            } else {
              setTimelineEvents([]);
              setVehicleCount(0);
            }

            if (typeof payload.position_seconds === 'number') {
              setPlaybackTime(payload.position_seconds);
            }
            setPhase('live');
            return;
          }

          /**if (eventName === 'vehicle_count') {
            if (timelineEvents.length === 0 && typeof payload.count === 'number') {
              setVehicleCount(payload.count);
            }
            return;
            if (typeof payload.count === 'number') {
              setVehicleCount(payload.count);
            }
            return;
          }**/

          if (eventName === 'replay_finished') {
            setVideoUrl('');
            setPlaybackTime(0);
            setPhase('settle');
            return;
          }

          if (eventName === 'round_settled') {
            const eventRoundId = typeof payload.round_id === 'string' ? payload.round_id : null;
            // Settlement broadcasts may be repeated. Only accept one for the
            // currently displayed round; an old broadcast must not overwrite it.
            if (!eventRoundId || eventRoundId !== activeRoundIdRef.current) return;
            setRoom((current) => {
              if (!current) return current;
              const result = typeof payload.result === 'number' ? payload.result : current.round.result;
              return {
                ...current,
                status: 'FINISHED',
                round: {
                  ...current.round,
                  status: 'FINISHED',
                  result,
                },
              };
            });
            if (typeof payload.result === 'number') {
              setVehicleCount(payload.result);
              setVerifiedSettlementRoundId(eventRoundId);
            }
            setVideoUrl('');
            setPlaybackTime(0);
            setPhase('settle');
            return;
          }
          
          if (eventName === 'round_finished') {
            const eventRoundId = typeof payload.round_id === 'string' ? payload.round_id : null;
            if (!eventRoundId || eventRoundId !== activeRoundIdRef.current) return;
            setVideoUrl('');
            setPlaybackTime(0);
            setPhase('settle');
            return;
          }

          if (eventName === 'video_sync') {
            const roundId = typeof payload.round_id === 'string' ? payload.round_id : undefined;
            const statusValue = typeof payload.status === 'string' ? payload.status : undefined;
            const videoId = typeof payload.video_id === 'string' ? payload.video_id : undefined;
            const nextVideoUrl = typeof payload.video_url === 'string' ? toAbsoluteUrl(payload.video_url) : '';
            setRoom((current) => {
              if (!current) return current;
              return {
                ...current,
                status: statusValue ?? current.status,
                round: {
                  ...current.round,
                  id: roundId ?? current.round.id,
                  status: statusValue ?? current.round.status,
                  video_id: videoId ?? current.round.video_id,
                },
              };
            });
            if (nextVideoUrl) setVideoUrl(nextVideoUrl);
            if (typeof payload.position_seconds === 'number') {
              setPlaybackTime(payload.position_seconds);
            }
            if (statusValue) {
              setPhase(mapPhase(statusValue));
            }
          }
        } catch {
          // Ignore malformed websocket payloads.
        }
      });

      socket.addEventListener('close', () => {
        socketRef.current = null;
        window.setTimeout(() => {
          connectSocket();
          void syncRoom();
        }, 1000);
      });
    };

    void syncRoom();
    connectSocket();

    return () => {
      socketRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (phase !== 'settle' || !room?.round.id || room.round.result == null) {
      return;
    }

    const roundId = Number(room.round.id);
    if (settledRoundRef.current === roundId) {
      return;
    }

    settledRoundRef.current = roundId;
    const settledResult = room.round.result;
    if (settledResult != null) {
      setRecentLines((lines) => [
        { id: roundId, value: String(settledResult), side: (settledResult > Number(room.threshold) ? 'OVER' : 'UNDER') as Side },
        ...lines,
      ].slice(0, 16));
    }
  }, [phase, room?.round.id, room?.round.result]);

  const roundTimestamps: number[] = timelineEvents.map((event) => event.timestamp_ms);
  const finalCount = room?.round.result;
  // A local clock can enter the settle window a moment before the backend has
  // submitted the result. Do not substitute 0 (or a previous round's value).
  const lastWinner = phase === 'settle'
    && verifiedSettlementRoundId === room?.round.id
    && typeof finalCount === 'number'
    && Number.isFinite(finalCount)
    ? { side: (finalCount > Number(room.threshold) ? 'OVER' : 'UNDER') as Side, finalCount, line: Number(room.threshold) }
    : null;

  let secondsLeft = 0;
  if (phase === 'betting') {
    const target = parseTimestamp(room?.round.betting_closes_at ?? null);
    // REMOVED Math.abs and added Math.max to clamp at 0
    secondsLeft = target == null ? 0 : Math.max(0, Math.ceil((target - now) / 1000));
  } else if (phase === 'locked') {
    const target = parseTimestamp(room?.round.locked_ends_at ?? null);
    // REMOVED Math.abs and added Math.max to clamp at 0
    secondsLeft = target == null ? 0 : Math.max(0, Math.ceil((target - now) / 1000));
  } else if (phase === 'live') {
    const target = parseTimestamp(room?.round.live_ends_at ?? null);
    secondsLeft = target == null ? 0 : Math.max(0, Math.ceil((target - now) / 1000));
  } else if (phase === 'settle') {
    const target = parseTimestamp(room?.round.ends_at ?? null);
    secondsLeft = target == null ? 0 : Math.max(0, Math.ceil((target - now) / 1000));
  } else {
    secondsLeft = 0;
  }

  const start_time = parseTimestamp(room?.round.starts_at);
  const betting_time = parseTimestamp(room?.round.betting_closes_at);
  const locked_time = parseTimestamp(room?.round.locked_ends_at);
  const live_time = parseTimestamp(room?.round.live_ends_at);
  const settle_time = parseTimestamp(room?.round.ends_at);

  let totalForPhase = 0;
  if (phase === 'betting') {
    totalForPhase = Math.floor(Math.abs(start_time - betting_time) / 1000);
  } else if (phase === 'locked') {
    totalForPhase = Math.floor(Math.abs(locked_time - betting_time) / 1000);
  } else if (phase === 'live') {
    totalForPhase = Math.floor(Math.abs(locked_time - live_time) / 1000);
  } else if (phase === 'settle') {
    totalForPhase = Math.floor(Math.abs(live_time - settle_time) / 1000);
  } else {
    totalForPhase = 0;
  }
    
  return {
    isLoading: room === null,
    phase,
    secondsLeft,
    totalForPhase,
    vehicleCount,
    roundId: room ? room.round.id : "",
    roundNumber: room ? Number(room.round.round_number) : 0,
    recentLines,
    lastWinner,
    isLocked: phase !== 'betting',
    videoUrl,
    playbackTime,
    threshold: room ? Number(room.threshold) : 0,
    locationName: room?.location_name ?? (room?.round.video_id ? `Round ${room.round.round_number}` : 'Sinjutu, Tokyo'),
    timelineEvents,
    roundTimestamps,
    pool: {under: 0.3, over: 0.5}
  };
}
