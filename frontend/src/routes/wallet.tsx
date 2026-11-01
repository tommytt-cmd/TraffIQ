import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { useWallet } from "@/hooks/useWallet";

export const Route = createFileRoute("/wallet")({
  head: () => ({
    meta: [
      { title: "Wallet — ElyRush" },
      {
        name: "description",
        content:
          "Connect and manage your wallet on the ElyRush Elysium deployment.",
      },
      { property: "og:title", content: "Wallet — ElyRush" },
      {
        property: "og:description",
        content:
          "Manage your ElyRush wallet connection and network status on Elysium.",
      },
    ],
  }),
  component: WalletPage,
});

function WalletPage() {
  const wallet = useWallet();
  const apiBase = (import.meta.env.VITE_GAME_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
  const activityQuery = useQuery({
    queryKey: ["wallet-activity", wallet.address?.toLowerCase()],
    enabled: Boolean(wallet.connected && wallet.address),
    queryFn: async () => {
      const historyResponse = await fetch(`${apiBase}/api/v1/profile/history?wallet_address=${encodeURIComponent(wallet.address!)}`, { cache: "no-store" });
      if (!historyResponse.ok) throw new Error("Could not load bet history.");
      const bets = await historyResponse.json() as Array<Record<string, any>>;
      const settledBets = await Promise.all(bets.filter((bet) => bet.round_id).map(async (bet) => {
        try {
          const response = await fetch(`${apiBase}/rounds/${bet.round_id}/players/${encodeURIComponent(wallet.address!)}/settlement`, { cache: "no-store" });
          return { ...bet, settlement: response.ok ? await response.json() : null };
        } catch {
          return { ...bet, settlement: null };
        }
      }));
      return settledBets;
    },
    staleTime: 30_000,
  });

  const connectWallet = async () => {
    try {
      await wallet.connect("MetaMask");
    } catch (error) {
      console.error("Wallet connect failed", error);
    }
  };

  const disconnectWallet = async () => {
    try {
      await wallet.disconnect();
    } catch (error) {
      console.error("Wallet disconnect failed", error);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
      <p className="label-tech">Wallet</p>
      <h1 className="mt-3 max-w-2xl text-4xl leading-[0.95] sm:text-5xl">
        Manage your <span className="text-primary">Ely</span>Rush wallet
      </h1>

      <div className="mt-10 rounded-3xl border border-border bg-surface-2/70 p-6">
        {wallet.connected && wallet.address ? (
          <div className="space-y-5">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Connected wallet</p>
              <p className="mt-2 max-w-full truncate font-mono text-lg text-foreground" title={wallet.address}>
                {wallet.address.slice(0, 8)}…{wallet.address.slice(-6)}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-border bg-background p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Status</p>
                <p className="mt-2 text-sm text-foreground">{wallet.status}</p>
              </div>
              <div className="rounded-2xl border border-border bg-background p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Balance</p>
                <p className="mt-2 text-sm text-foreground">{wallet.balance.toFixed(4)} HYPE</p>
              </div>
              <div className="rounded-2xl border border-border bg-background p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Network</p>
                <p className="mt-2 text-sm text-foreground">
                  {wallet.isCorrectNetwork ? "Elysium" : "Wrong network"}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              {!wallet.isCorrectNetwork ? (
                <button
                  type="button"
                  onClick={() => void wallet.switchNetwork()}
                  className="rounded-full bg-primary px-5 py-3 text-sm font-bold uppercase tracking-[0.16em] text-primary-foreground"
                >
                  Switch network
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => void disconnectWallet()}
                className="rounded-full border border-border bg-background px-5 py-3 text-sm font-bold uppercase tracking-[0.16em] text-foreground"
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Connect your wallet to view your balance, network status, and account activity.
            </p>

            <button
              type="button"
              onClick={() => void connectWallet()}
              className="rounded-full bg-primary px-5 py-3 text-sm font-bold uppercase tracking-[0.16em] text-primary-foreground"
            >
              Connect wallet
            </button>
          </div>
        )}
      </div>

      {wallet.connected && wallet.address ? (
        <WalletActivity bets={activityQuery.data ?? []} isLoading={activityQuery.isLoading} error={activityQuery.error} />
      ) : null}

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          to="/"
          className="clip-tag bg-primary px-5 py-3 font-display text-xs font-bold uppercase tracking-[0.16em] text-primary-foreground"
        >
          Go to live round
        </Link>
        <Link
          to="/how-it-works"
          className="clip-tag border border-primary/60 px-5 py-3 font-display text-xs font-bold uppercase tracking-[0.16em] text-primary"
        >
          Learn the flow
        </Link>
      </div>
    </div>
  );
}

function WalletActivity({ bets, isLoading, error }: { bets: Array<Record<string, any>>; isLoading: boolean; error: Error | null }) {
  const winners = bets.filter((bet) => bet.status === "WON" || bet.settlement?.is_winner === true);
  const claimed = winners.filter((bet) => bet.settlement?.has_claimed || bet.settlement?.claim_status === "CLAIMED");
  const awaiting = winners.filter((bet) => !bet.settlement?.has_claimed && (bet.settlement?.claim_status === "AVAILABLE" || Number(bet.settlement?.pending_eth ?? 0) > 0));

  return (
    <div className="mt-10 space-y-6">
      <div>
        <p className="label-tech">Wallet activity</p>
        <h2 className="mt-2 text-3xl">Bets and winnings</h2>
      </div>
      {error ? <p className="rounded-2xl border border-rose-400/40 bg-rose-400/10 p-4 text-sm text-rose-200">{error.message}</p> : null}
      <section className="panel overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr className="border-b border-border">
              <th className="label-tech px-4 py-3">Won / Lost</th>
              <th className="label-tech px-2 py-3">Stake</th>
              <th className="label-tech px-2 py-3">Amount won / lost</th>
              <th className="label-tech px-2 py-3">Prediction</th>
              <th className="label-tech px-2 py-3">Result</th>
              <th className="label-tech px-2 py-3 text-right">Round ID</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">Loading bet history…</td></tr>
            ) : bets.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">No bets yet.</td></tr>
            ) : bets.map((bet) => {
              const stake = Number(bet.stake ?? 0) / 1e18;
              const won = bet.status === "WON" || bet.settlement?.is_winner === true;
              const resultAmount = won ? stake : bet.status === "LOST" ? -stake : 0;
              const prediction = Number(bet.prediction) === 0
                ? "OVER"
                : Number(bet.prediction) === 1
                  ? "UNDER"
                  : "—";
              return (
                <tr key={bet.bet_id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3">
                    <span className={won
                      ? "clip-tag border border-emerald-500 bg-emerald-500/15 px-2 py-0.5 font-mono text-[0.625rem] uppercase text-emerald-700"
                      : bet.status === "LOST"
                        ? "clip-tag border border-rose-400 bg-rose-400/15 px-2 py-0.5 font-mono text-[0.625rem] uppercase text-rose-700"
                        : "clip-tag border border-border bg-background px-2 py-0.5 font-mono text-[0.625rem] uppercase text-muted-foreground"}>
                      {won ? "Won" : bet.status === "LOST" ? "Lost" : "Pending"}
                    </span>
                  </td>
                  <td className="px-2 py-3 font-mono text-sm tabular-nums">{stake.toLocaleString(undefined, { maximumFractionDigits: 4 })} HYPE</td>
                  <td className={`px-2 py-3 font-mono text-sm tabular-nums ${resultAmount > 0 ? "text-emerald-700" : resultAmount < 0 ? "text-rose-700" : "text-muted-foreground"}`}>
                    {resultAmount > 0 ? "+" : ""}{resultAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} HYPE
                  </td>
                  <td className="px-2 py-3 font-mono text-sm">{prediction}</td>
                  {/* Profile history's result is the settled round's final count. */}
                  <td className="px-2 py-3 font-mono text-sm tabular-nums">{bet.result ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">{bet.round_number == null ? "—" : `#${bet.round_number}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <div className="grid gap-5 sm:grid-cols-2">
        {[
          { title: "Claimed rounds", items: claimed },
          { title: "Awaiting claim", items: awaiting },
        ].map((section) => (
          <section key={section.title} className="rounded-3xl border border-border bg-surface-2/70 p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-xl">{section.title}</h3>
              <span className="rounded-full border border-border px-3 py-1 font-mono text-xs text-muted-foreground">{section.items.length}</span>
            </div>
            {isLoading ? <p className="py-2 text-sm text-muted-foreground">Loading…</p> : section.items.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No rounds.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {section.items.map((bet) => <li key={bet.bet_id} className="rounded-full border border-border bg-background px-3 py-1 font-mono text-xs">Round #{bet.round_number ?? "—"}</li>)}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
