import { Link } from "@tanstack/react-router";
import { Wallet } from "lucide-react";

import { useWallet } from "@/hooks/useWallet";
import { WalletStatus } from "@/components/wallet-status";
import { shortAddress } from "@/lib/round";
import { useWalletModal } from "@/components/wallet-connect-modal";

const NAV = [
  { to: "/", label: "Live" },
  { to: "/how-it-works", label: "How it works" },
  { to: "/wallet", label: "Wallet" },
  { to: "/about", label: "About" },
] as const;

const ticker = import.meta.env["TICKER"] ?? 'HYPE';

export function SiteHeader() {
  const wallet = useWallet();
  const { setOpen } = useWalletModal();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-6">
          <Link to="/" className="flex shrink-0 items-center gap-2">
            {/*<span className="flex h-5 w-5 flex-col items-center justify-center gap-[2px] rounded-full border border-primary/50 bg-surface px-[3px] py-[2px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>*/}
            <span className="font-display text-lg font-bold tracking-[0.12em] text-foreground">
              Ely<span className="text-primary">Rush</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-6 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="label-tech transition-colors hover:text-primary"
                activeProps={{ className: "label-tech text-primary" }}
                activeOptions={{ exact: item.to === "/" }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {wallet.address ? (
            <div className="sm:block">
              <Link
                to="/wallet"
                className="clip-tag border border-primary/60 bg-primary/10 px-3 py-2 font-mono text-xs text-primary"
              >
                {shortAddress(wallet.address)} · {/*wallet.balance.toFixed(3)} {ticker*/}
              </Link>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="clip-tag flex items-center gap-2 bg-primary px-3 py-2 font-display text-xs font-bold uppercase tracking-[0.14em] text-primary-foreground transition-opacity hover:opacity-85"
            >
              <Wallet className="h-4 w-4" />
              <span className="hidden sm:inline">Connect wallet</span>
              <span className="sm:hidden">Connect</span>
            </button>
          )}

          {/*wallet.address ? (
            <WalletStatus />
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="clip-tag flex items-center gap-2 bg-primary px-3 py-2 font-display text-xs font-bold uppercase tracking-[0.14em] text-primary-foreground transition-opacity hover:opacity-85"
            >
              <Wallet className="h-4 w-4" />
              <span className="hidden sm:inline">Connect wallet</span>
              <span className="sm:hidden">Connect</span>
            </button>
          )*/}
        </div>
      </div>
    </header>
  );
}
