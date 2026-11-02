import { Lock, Radio, ScanLine, Timer } from "lucide-react";

import { formatCountdown, PHASE_COPY, PHASE_DURATIONS } from "@/lib/round";
import type { GamePhase } from "@/lib/types";
import { cn } from "@/lib/utils";

const PHASE_STYLE: Record<
  GamePhase,
  { icon: typeof Timer; wrap: string; text: string; bar: string; dot: string }
> = {
  betting: {
    icon: Timer,
    wrap: "border-accent/60 bg-accent/10",
    text: "text-accent",
    bar: "bg-accent",
    dot: "bg-accent",
  },
  locked: {
    icon: Lock,
    wrap: "border-warning/60 bg-warning/10",
    text: "text-warning",
    bar: "bg-warning",
    dot: "bg-warning",
  },
  live: {
    icon: Radio,
    wrap: "border-primary/60 bg-primary/10",
    text: "text-primary",
    bar: "bg-primary",
    dot: "bg-primary",
  },
  settle: {
    icon: ScanLine,
    wrap: "border-border bg-surface-2/70",
    text: "text-foreground",
    bar: "bg-foreground",
    dot: "bg-foreground",
  },
};

export function PhaseStatus({ phase, remaining, totalForPhase }: { phase: GamePhase; remaining: number; totalForPhase: number; }) {
  const s = PHASE_STYLE[phase];
  const Icon = s.icon;
  const progress = 1 - remaining / totalForPhase;

  return (
    <div className={cn("clip-tag border p-4", s.wrap)}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0 items-center gap-3">
          <div className="flex">
            <span className={cn("shrink-0", s.text)}>
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-2">
                <span className={cn("live-dot h-2 w-2 shrink-0 rounded-full", s.dot)} />
                <span
                  className={cn(
                    "truncate font-display text-base font-bold uppercase tracking-[0.14em]",
                    s.text,
                  )}
                >
                  {PHASE_COPY[phase].label}
                </span>
              </p>
              {/*<p className="mt-1 truncate text-xs text-muted-foreground">{PHASE_COPY[phase].blurb}</p>*/}
            </div>
          </div>
          <div className="mt-4 h-1 w-full bg-secondary">
            <div
              className={cn("h-full transition-[width] duration-1000 ease-linear", s.bar)}
              style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
            />
          </div>
        </div>
        
        <div className="shrink-0 text-right">
          <p className="label-tech">Next phase</p>
          <p className={cn("font-mono text-2xl", s.text)}>{formatCountdown(remaining)}</p>
        </div>
      </div>
      
    </div>
  );
}
