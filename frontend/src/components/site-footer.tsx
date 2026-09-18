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
            <span className="font-display text-lg font-bold tracking-[0.28em] text-foreground">
              Traff<span className="text-primary">I<svg xmlns="http://www.w3.org/2000/svg" width="18" height="22" viewBox="0 0 220 300" fill="none" className="inline-block -ml-1">
                        <path d=" M 65 20 H 155 C 190 20 205 40 205 75 V 215 C 205 250 190 270 155 270 H 65 C 30 270 15 250 15 215 V 75 C 15 40 30 20 65 20 Z M 65 65 C 52 65 45 72 45 85 V 205 C 45 218 52 225 65 225 H 155 C 168 225 175 218 175 205 V 85 C 175 72 168 65 155 65 Z " fill="#A8FF19" fill-rule="evenodd" />
                        <path d=" M 145 225 L 205 285 L 175 315 L 115 255 Z " fill="#A8FF19" />
                        <rect x="75" y="85" width="70" height="130" rx="16" fill="#050807" />
                        <rect x="68" y="98" width="88" height="18" rx="14" fill="#FF315D" />
                        <rect x="68" y="136" width="88" height="18" rx="14" fill="#FFC84A" />
                        <rect x="68" y="174" width="88" height="18" rx="14" fill="#49C99B" />
                      </svg>
                    </span> 
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
