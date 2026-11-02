import { useEffect, useState, useMemo, useRef, memo } from "react";
import { Loader2 } from "lucide-react";

import heroImage from "@/assets/hero-traffic.jpg";
import type { GamePhase } from "@/lib/types";

export type Side = 'OVER' | 'UNDER';

interface SettleData {
  side: Side;
  finalCount: number;
  line: number;
}

interface LiveStreamViewportProps {
  phase: GamePhase;
  settleData: SettleData | null;
  videoUrl: string;
  threshold: number;
  playbackTime: number;
  locationName: string;
  timelineEvents: { timestamp_ms: number; cumulative_count: number }[];
}

function seekVideoToTime(video: HTMLVideoElement, targetTime: number) {
  if (!Number.isFinite(video.duration) || video.duration <= 0) return;

  const clampedTime = Math.min(targetTime, Math.max(0, video.duration - 0.1));
  if (Math.abs(video.currentTime - clampedTime) > 0.3) {
    video.currentTime = clampedTime;
  }
}

// Optimization: Extracted to a memoized component.
// Updating the number display will NO LONGER re-render the underlying video stream.
const LiveCounterOverlay = memo(function LiveCounterOverlay({
  count,
  threshold,
}: {
  count: number;
  threshold: number;
}) {
  const [pop, setPop] = useState(false);
  const prevCount = useRef(count);

  useEffect(() => {
    if (count !== prevCount.current) {
      prevCount.current = count;
      setPop(true);
      const t = setTimeout(() => setPop(false), 290);
      return () => clearTimeout(t);
    }
  }, [count]);

  return (
    <div className="clip-tag absolute right-0 top-0 border border-primary/80 bg-black/80 px-3 py-2 text-right backdrop-blur-md">
      <p className="label-tech text-primary">Vehicles</p>
      <p className={`font-display text-3xl font-bold tabular-nums text-primary sm:text-2xl ${pop ? 'animate-pop-scale' : ''}`}>
        {count}
      </p>
    </div>
  );
});

export function LiveStream({
  phase,
  settleData,
  videoUrl,
  threshold,
  playbackTime,
  locationName,
  timelineEvents = [],
}: LiveStreamViewportProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [displayCount, setDisplayCount] = useState(0);
  const lastSyncedTimeRef = useRef<number>(-1);
  
  const showVideo = phase === "live" || phase === "settle";

  // Reset counter to 0 when leaving live phase
  useEffect(() => {
    if (phase !== 'live') {
      setDisplayCount(0);
    }
  }, [phase]);

  // Unified Video Control Loop with End-of-Video Guard
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    if (showVideo) {
      // 🚨 FIX: If the video has naturally finished playing, stop running sync logic
      if (video.ended) {
        video.playbackRate = 1.0;
        return;
      }

      // Ensure video is playing
      if (video.paused) {
        video.play().catch((err) => console.error("Video play blocked:", err));
      }
      
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      if (lastSyncedTimeRef.current === playbackTime) return;
      lastSyncedTimeRef.current = playbackTime;

      const currentDrift = video.currentTime - playbackTime;
      const absDrift = Math.abs(currentDrift);

      if (absDrift > 3.5) {
        video.playbackRate = 1.0;
        seekVideoToTime(video, playbackTime);
      } else if (absDrift > 0.8) {
        if (currentDrift < 0) {
          video.playbackRate = 1.15; // Local video behind -> speed up
        } else {
          video.playbackRate = 0.85; // Local video ahead -> slow down
        }
      } else {
        video.playbackRate = 1.0; // In sync
      }
    } else {
      video.pause();
      video.playbackRate = 1.0;
      setDisplayCount(0);
    }
  }, [showVideo, playbackTime, videoUrl]);

  useEffect(() => {
    // A new URL must be treated as a new media resource; retaining the old
    // sync marker can otherwise skip its initial seek/play.
    lastSyncedTimeRef.current = -1;
  }, [videoUrl]);



  const sortedTimeline = useMemo(() => {
    return [...(timelineEvents ?? [])].sort((a, b) => a.timestamp_ms - b.timestamp_ms);
  }, [timelineEvents]);

  return (
    <div className="panel scanline relative overflow-hidden">
      <div className="relative aspect-video w-full bg-background">
        <video
          className={`h-full w-full object-cover transition-opacity duration-300 ${
            showVideo ? "opacity-100 block" : "opacity-0 invisible h-0 w-0 absolute"
          }`}
          ref={videoRef}
          key={videoUrl}
          muted
          playsInline
          aria-label={locationName}
          preload="auto" // Forces the browser to aggressively cache and buffer ahead
          controls={false}
          controlsList="nodownload noplaybackrate"
          disablePictureInPicture
          onLoadedMetadata={() => {
            if (videoRef.current) seekVideoToTime(videoRef.current, playbackTime);
          }}
          onError={(event) => {
            const mediaError = event.currentTarget.error;
            console.error('Unable to load livestream source:', {
              url: event.currentTarget.currentSrc || videoUrl,
              code: mediaError?.code,
              message: mediaError?.message,
            });
          }}
          onTimeUpdate={(event) => {
            const currentMs = Math.round(event.currentTarget.currentTime * 1000);
            
            let newCount = 0;
            for (let i = sortedTimeline.length - 1; i >= 0; i--) {
              if (sortedTimeline[i].timestamp_ms <= currentMs) {
                newCount = sortedTimeline[i].cumulative_count;
                break; 
              }
            }

            if (newCount !== displayCount) {
              setDisplayCount(newCount);
            }
          }}
        >
          {videoUrl && <source src={videoUrl} type="video/mp4" />}
        </video>

        {/* Feed label */}
        <div className="clip-tag absolute left-2 top-0 flex items-center gap-2 border border-primary/60 bg-background/70 px-2 py-1 font-mono text-[0.625rem] uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
          {locationName}
        </div>

        {/* BETTING: question + threshold */}
        {phase === "betting" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80 px-6 text-center backdrop-blur-sm">
            {/*<p className="label-tech text-accent">Betting open</p>*/}
            <p className="max-w-md font-display text-lg font-bold uppercase leading-tight sm:text-2xl">
              How many vehicles will be counted?
            </p>
            <p className="max-w-md font-display text-lg font-bold uppercase leading-tight sm:text-2xl">
              {locationName}
            </p>
            <p className="font-mono text-xs text-muted-foreground">Threshold</p>
            <p className="font-display text-5xl font-bold tabular-nums text-accent sm:text-7xl">
              {threshold}
            </p>
          </div>
        )}

        {/* LOCKED: connecting spinner */}
        {phase === "locked" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/85 text-center backdrop-blur-sm">
            <Loader2 className="h-8 w-8 animate-spin text-warning" />
            <p className="label-tech text-warning">Connecting to livestream</p>
            <p className="font-mono text-xs text-muted-foreground">
              Positions sealed · syncing {locationName} cameras
            </p>
          </div>
        )}

        {/* LIVE: optimized counter overlay top-right */}
        {phase === "live" && displayCount > 0 && (
          <LiveCounterOverlay count={displayCount} threshold={threshold} />
        )}

        {/* SETTLING: result */}
        {phase === "settle" && settleData && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/85 text-center backdrop-blur-sm">
            <p className="label-tech">Final count verified</p>
            <p className="font-display text-6xl font-bold tabular-nums text-foreground sm:text-7xl">
              {settleData.finalCount.toLocaleString()}
            </p>
            <p className="clip-tag mt-2 bg-primary px-4 py-1.5 font-display text-sm font-bold uppercase tracking-[0.16em] text-primary-foreground">
              {settleData.side} {threshold} wins
            </p>
          </div>
        )}
        {phase === "settle" && !settleData && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/85 text-center backdrop-blur-sm">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="label-tech text-primary">Verifying final count</p>
          </div>
        )}
      </div>
    </div>
  );
}
