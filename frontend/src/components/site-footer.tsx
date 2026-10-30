import { Link } from "@tanstack/react-router";
import { Activity } from "lucide-react";

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface/40">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[2fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2">
            {/*<span className="flex h-5 w-5 flex-col items-center justify-center gap-[2px] rounded-full border border-primary/50 bg-surface px-[3px] py-[2px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>*/}
            <span className="font-display text-lg font-bold tracking-[0.12em] text-foreground">
              Ely<span className="text-primary">Rush</span>
            </span>
          </div>
          <p className="mt-3 max-w-sm text-sm text-muted-foreground">
            Live vehicle-count prediction market. Stake under or over the threshold, settle on verified
            junction camera data.
          </p>
        </div>
        <div>
          <p className="label-tech">Product</p>
          <div className="mt-3 grid gap-2 text-sm">
            <Link to="/" className="hover:text-primary">
              Live round
            </Link>
            <Link to="/how-it-works" className="hover:text-primary">
              How it works
            </Link>
            <Link to="/wallet" className="hover:text-primary">
              Wallet
            </Link>
          </div>
        </div>
        <div>
          <p className="label-tech">Other</p>
          <div className="mt-3 grid gap-2 text-sm">
            <Link to="/about" className="hover:text-primary">
              About
            </Link>
            <span className="text-muted-foreground">Docs — soon</span>
            <span className="text-muted-foreground">Feed API — soon</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
