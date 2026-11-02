import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Wallet } from "lucide-react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";

import { useWallet } from "@/hooks/useWallet";
import { BettingContractService } from "@/services/blockchain/bettingContractService";
import { TransactionService } from "@/services/blockchain/transactionService";
import { elysiumTestnetChain } from "@/services/blockchain/wagmi";

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
  const { address: accountAddress, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const connectedAddress = accountAddress ?? wallet.address;
  const connected = Boolean(accountAddress && chainId);
  const isCorrectNetwork = chainId === elysiumTestnetChain.id;
  const [claimingRound, setClaimingRound] = useState<number | null>(null);
  const apiBase = (import.meta.env.VITE_GAME_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
  const activityQuery = useQuery({
    queryKey: ["wallet-activity", connectedAddress?.toLowerCase()],
    enabled: Boolean(connected && connectedAddress),
    queryFn: async () => {
      const historyResponse = await fetch(`${apiBase}/api/v1/profile/history?wallet_address=${encodeURIComponent(connectedAddress!)}`, { cache: "no-store" });
      if (!historyResponse.ok) throw new Error("Could not load bet history.");
      const bets = await historyResponse.json() as Array<Record<string, any>>;
      const settledBets = await Promise.all(bets.filter((bet) => bet.round_id).map(async (bet) => {
        const [settlement, onchainWinnings] = await Promise.all([
          fetch(`${apiBase}/rounds/${bet.round_id}/players/${encodeURIComponent(connectedAddress!)}/settlement`, { cache: "no-store" })
            .then(async (response) => response.ok ? await response.json() : null)
            .catch(() => null),
          wallet.provider && connectedAddress && bet.round_number != null
            ? BettingContractService.getRoundWinningsStatus(wallet.provider, Number(bet.round_number), connectedAddress as `0x${string}`)
                .then((status) => ({ pending: status.pending.toString(), claimed: status.claimed }))
                .catch(() => null)
            : Promise.resolve(null),
        ]);
        return { ...bet, settlement, onchainWinnings };
      }));
      return settledBets;
    },
    staleTime: 30_000,
  });

  const claimWinnings = async (roundNumber: number) => {
    if (!wallet.provider || !wallet.signer || !connectedAddress || !isCorrectNetwork) {
      toast.error("Connect your wallet to Elysium before claiming.");
      return;
    }

    setClaimingRound(roundNumber);
    try {
      const winnings = await BettingContractService.getRoundWinningsStatus(
        wallet.provider,
        roundNumber,
        connectedAddress as `0x${string}`,
      );
      if (winnings.claimed) throw new Error("Winnings for this round have already been claimed.");
      if (winnings.pending === 0n) throw new Error("This round has no claimable HYPE for your wallet.");
      const hash = await BettingContractService.claimEth(wallet.signer, roundNumber);
      await wallet.provider.waitForTransactionReceipt({ hash });
      toast.success(`Round #${roundNumber} winnings claimed.`);
      await activityQuery.refetch();
    } catch (error) {
      toast.error(TransactionService.normalizeError(error));
    } finally {
      setClaimingRound(null);
    }
  };

  const connectWallet = () => openConnectModal?.();

  const disconnectWallet = async () => {
    try {
      await wallet.disconnect();
    } catch (error) {
      console.error("Wallet disconnect failed", error);
    }
  };

  const activityBets = activityQuery.data ?? [];
  const wonBets = activityBets.filter((bet) =>
    typeof bet.settlement?.is_winner === "boolean"
      ? bet.settlement.is_winner
      : bet.status === "WON",
  );
  const settledBets = activityBets.filter((bet) =>
    typeof bet.settlement?.is_winner === "boolean" ||
    bet.status === "WON" ||
    bet.status === "LOST",
  );
  const unclaimedBets = activityBets.filter((bet) => {
    if (bet.round_number == null) return false;
    const hasBeenClaimed = typeof bet.onchainWinnings?.claimed === "boolean"
      ? bet.onchainWinnings.claimed
      : Boolean(bet.settlement?.has_claimed || bet.settlement?.claim_status === "CLAIMED");
    const hasPendingWinnings = bet.onchainWinnings?.pending !== undefined
      ? BigInt(bet.onchainWinnings.pending) > 0n
      : bet.settlement?.claim_status === "AVAILABLE" ||
        Number(bet.settlement?.pending_eth ?? 0) > 0;
    return !hasBeenClaimed && hasPendingWinnings;
  }).filter((bet, index, unclaimed) =>
    unclaimed.findIndex((candidate) => candidate.round_number === bet.round_number) === index,
  );
  const totalWinnings = activityBets.reduce((total, bet) => {
    const pending = bet.onchainWinnings?.pending != null
      ? Number(bet.onchainWinnings.pending) / 1e18
      : Number(bet.settlement?.pending_eth ?? 0);
    return total + (Number.isFinite(pending) ? pending : 0);
  }, 0);
  const winRate = settledBets.length
    ? (wonBets.length / settledBets.length) * 100
    : 0;
  const kpis = [
    {
      label: "HYPE balance",
      value: `${wallet.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })} HYPE`,
      detail: "On Elysium",
      accent: "bg-primary text-primary-foreground",
    },
    {
      label: "Total bets",
      value: activityQuery.isLoading ? "…" : activityBets.length.toLocaleString(),
      detail: "All recorded rounds",
      accent: "bg-background text-foreground",
    },
    {
      label: "Claimable winnings",
      value: activityQuery.isLoading
        ? "…"
        : `${totalWinnings.toLocaleString(undefined, { maximumFractionDigits: 4 })} HYPE`,
      detail: "Available to claim",
      accent: "bg-emerald-500 text-black",
    },
    {
      label: "Win rate",
      value: activityQuery.isLoading ? "…" : `${winRate.toFixed(1)}%`,
      detail: `${wonBets.length} rounds won`,
      accent: "bg-secondary text-secondary-foreground",
    },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
      <p className="label-tech">Wallet</p>
      <h1 className="mt-3 max-w-2xl text-4xl leading-[0.95] sm:text-5xl">
        Manage your <span className="text-primary">Ely</span>Rush wallet
      </h1>

      <div className="mt-10 border-2 border-foreground bg-surface-2/70 p-5 shadow-[6px_6px_0_hsl(var(--foreground))] sm:p-6">
        {connected && connectedAddress ? (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {kpis.map((kpi) => (
                <div key={kpi.label} className={`clip-tag min-w-0 border-2 border-foreground p-4 shadow-[3px_3px_0_hsl(var(--foreground))] ${kpi.accent}`}>
                  <p className="font-display text-[0.65rem] font-black uppercase tracking-[0.16em]">{kpi.label}</p>
                  <p className="mt-3 truncate font-mono text-xl font-bold tabular-nums sm:text-2xl" title={kpi.value}>{kpi.value}</p>
                  <p className="mt-1 truncate text-xs opacity-75">{kpi.detail}</p>
                </div>
              ))}
            </div>

            {!activityQuery.isLoading && unclaimedBets.length > 0 ? (
              <div className="clip-tag flex flex-wrap items-center justify-between gap-3 border-2 border-foreground bg-amber-300 p-4 text-black shadow-[3px_3px_0_hsl(var(--foreground))]">
                <div>
                  <p className="font-display text-sm font-black uppercase tracking-[0.12em]">
                    You have {unclaimedBets.length} unclaimed {unclaimedBets.length === 1 ? "round" : "rounds"}
                  </p>
                  <p className="mt-1 font-mono text-xs">
                    {unclaimedBets.map((bet) => `#${bet.round_number}`).join(", ")} · Claim your HYPE from the table below.
                  </p>
                </div>
                <span aria-hidden="true" className="font-display text-2xl font-black">!</span>
              </div>
            ) : null}

            <div className="flex flex-col justify-between gap-4 border-t-2 border-foreground pt-4 sm:flex-row sm:items-end">
              <div className="min-w-0">
                <p className="font-display text-xs font-black uppercase tracking-[0.2em] text-muted-foreground">Connected wallet</p>
                <p className="mt-1 max-w-full truncate font-mono text-sm text-foreground" title={connectedAddress}>
                  {connectedAddress.slice(0, 8)}…{connectedAddress.slice(-6)}
                </p>
                <p className="mt-2 font-mono text-xs uppercase text-muted-foreground">
                  Network: <span className={isCorrectNetwork ? "font-bold text-emerald-500" : "font-bold text-rose-500"}>{isCorrectNetwork ? `Elysium ${wallet.chainId}` : "Wrong network"}</span>
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap gap-3">
              {!isCorrectNetwork ? (
                <button
                  type="button"
                  onClick={() => void wallet.switchNetwork()}
                  className="clip-tag border-2 border-foreground bg-primary px-5 py-3 font-display text-xs font-black uppercase tracking-[0.16em] text-primary-foreground shadow-[3px_3px_0_hsl(var(--foreground))]"
                >
                  Switch network
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => void disconnectWallet()}
                className="clip-tag border-2 border-destructive bg-destructive/10 px-5 py-3 font-display text-xs font-black uppercase tracking-[0.16em] text-destructive shadow-[3px_3px_0_hsl(var(--destructive))] transition-transform hover:translate-x-[2px] hover:translate-y-[2px] hover:bg-destructive hover:text-destructive-foreground hover:shadow-[1px_1px_0_hsl(var(--destructive))]"
              >
                Disconnect
              </button>
              </div>
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
              className="clip-tag bg-primary px-5 py-3 font-display flex text-xs font-bold uppercase tracking-[0.16em] text-primary-foreground"
            >
              <Wallet className="h-4 w-4" />
              Connect wallet
            </button>
          </div>
        )}
      </div>

      {connected && connectedAddress ? (
        <WalletActivity
          bets={activityBets}
          isLoading={activityQuery.isLoading}
          error={activityQuery.error}
          claimingRound={claimingRound}
          onClaim={(roundNumber) => void claimWinnings(roundNumber)}
        />
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

function WalletActivity({ bets, isLoading, error, claimingRound, onClaim }: {
  bets: Array<Record<string, any>>;
  isLoading: boolean;
  error: Error | null;
  claimingRound: number | null;
  onClaim: (roundNumber: number) => void;
}) {
  const isWinner = (bet: Record<string, any>) =>
    typeof bet.settlement?.is_winner === "boolean"
      ? bet.settlement.is_winner
      : bet.status === "WON";
  const pendingWinnings = (bet: Record<string, any>) =>
    Number(bet.onchainWinnings?.pending ?? bet.settlement?.pending_eth ?? 0) > 0;
  const hasClaimableWinnings = (bet: Record<string, any>) =>
    bet.onchainWinnings?.pending !== undefined
      ? BigInt(bet.onchainWinnings.pending) > 0n
      : bet.settlement?.claim_status === "AVAILABLE" || pendingWinnings(bet);
  const hasClaimed = (bet: Record<string, any>) =>
    typeof bet.onchainWinnings?.claimed === "boolean"
      ? bet.onchainWinnings.claimed
      : Boolean(bet.settlement?.has_claimed || bet.settlement?.claim_status === "CLAIMED");
  return (
    <div className="mt-10 space-y-6">
      <div>
        <p className="label-tech">Wallet activity</p>
        <h2 className="mt-2 text-3xl">Bets and winnings</h2>
      </div>
      {error ? <p className="rounded-2xl border border-rose-400/40 bg-rose-400/10 p-4 text-sm text-rose-200">{error.message}</p> : null}
      <section className="panel overflow-x-auto">
        <table className="w-full min-w-[320px] border-collapse text-left">
          <thead>
            <tr className="border-b border-border">
              <th className="label-tech px-2 py-3 text-primary-foreground">Round</th>
              <th className="label-tech px-2 py-3 text-primary-foreground">Result</th>
              <th className="label-tech px-2 py-3 text-primary-foreground">Winnings</th>
              <th className="label-tech px-4 py-3 text-primary-foreground text-right">Action</th>
              
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">Loading bet history…</td></tr>
            ) : bets.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">No bets yet.</td></tr>
            ) : bets.map((bet) => {
              const won = isWinner(bet) || pendingWinnings(bet);
              const canClaim = Boolean(
                bet.round_number != null &&
                !hasClaimed(bet) &&
                hasClaimableWinnings(bet),
              );
              const winningsWei = bet.onchainWinnings?.pending;
              const winningsEth = winningsWei != null
                ? Number(winningsWei) / 1e18
                : Number(bet.settlement?.pending_eth ?? 0);
              return (
                <tr key={bet.bet_id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">{bet.round_number == null ? "—" : `#${bet.round_number}`}</td>
                  <td className="px-2 py-3">
                    <span className={won
                      ? "clip-tag border border-emerald-500 bg-emerald-500/15 px-2 py-0.5 font-mono text-[0.625rem] uppercase text-emerald-700"
                      : bet.status === "LOST"
                        ? "clip-tag border border-rose-400 bg-rose-400/15 px-2 py-0.5 font-mono text-[0.625rem] uppercase text-rose-700"
                        : "clip-tag border border-border bg-background px-2 py-0.5 font-mono text-[0.625rem] uppercase text-muted-foreground"}>
                      {won ? "Won" : bet.status === "LOST" ? "Lost" : "Pending"}
                    </span>
                  </td>
                  <td className="px-2 py-3 font-mono text-sm tabular-nums">
                    {winningsEth > 0
                      ? `${winningsEth.toLocaleString(undefined, { maximumFractionDigits: 4 })} HYPE`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canClaim ? (
                      <button
                        type="button"
                        onClick={() => onClaim(Number(bet.round_number))}
                        disabled={claimingRound !== null}
                        className="clip-tag border border-primary px-3 py-2 font-mono text-xs text-primary disabled:cursor-wait disabled:opacity-50"
                      >
                        {claimingRound === Number(bet.round_number) ? "Claiming…" : "Claim HYPE"}
                      </button>
                    ) : hasClaimed(bet) ? (
                      <span className="font-mono text-xs text-muted-foreground">Claimed</span>
                    ) : bet.round_number == null ? (
                      <span className="font-mono text-xs text-muted-foreground">—</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

    </div>
  );
}
