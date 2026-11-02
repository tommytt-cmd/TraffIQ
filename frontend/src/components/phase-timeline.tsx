import { PHASE_COPY, PHASE_DURATIONS, PHASE_ORDER, type Phase } from "@/lib/round";
import { cn } from "@/lib/utils";

export function PhaseTimeline({ phase, remaining, totalForPhase }: { phase: Phase; remaining: number; totalForPhase: number }) {
  const activeIndex = PHASE_ORDER.indexOf(phase);

  return (
    <div className="grid gap-3 sm:grid-cols-4">
      {PHASE_ORDER.map((p, i) => {
        const active = i === activeIndex;
        const done = i < activeIndex;
        const progress = active ? 1 - remaining / totalForPhase : done ? 1 : 0;
        return (
           
          <div
            key={p}
            className={cn(
              "clip-tag border p-3",
              active
                ? "border-primary bg-primary/10"
                : done
                  ? "border-border bg-surface-2/60"
                  : "border-border bg-surface/60",
            )}
          >
            <div className="flex items-center justify-between">
              <span
                className={cn(
                  "font-mono text-[0.625rem] tracking-[0.2em]",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                0{i + 1}
              </span>
              {active && <span className="live-dot h-2 w-2 rounded-full bg-primary" />}
            </div>
            <p
              className={cn(
                "mt-2 font-display text-sm font-bold uppercase tracking-[0.1em]",
                active ? "text-primary" : "text-foreground",
              )}
            >
              {PHASE_COPY[p].label}
            </p>
            <div className="mt-3 h-1 w-full bg-secondary">
              <div
                className="h-full bg-primary transition-[width] duration-1000 ease-linear"
                style={{ width: `${Math.min(100, progress * 100)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
