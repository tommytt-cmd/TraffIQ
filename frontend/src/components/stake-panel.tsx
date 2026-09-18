import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { TrendingDown, TrendingUp, Lock } from "lucide-react";

import { useWallet as useBlockchainWallet } from "@/hooks/useWallet";
import { useBettingContract, type BetSide } from "@/hooks/useBettingContract";
import { useTransactions } from "@/hooks/useTransactions";
import { BetSyncService } from "@/services/blockchain/betSyncService";
import { TransactionService } from "@/services/blockchain/transactionService";
import { BettingContractService } from "@/services/blockchain/bettingContractService";
import { BetSlip } from "@/components/bet-slip";
import { cn } from "@/lib/utils";

const ticker = import.meta.env["TICKER"] ?? "ETH";

interface StakeProps {
  roundId: string;
  phase: string;
  roundNumber: number;
  threshold: number;
  pool: { under: number; over: number } | null;
}

const AMOUNTS = [0.001, 0.002, 0.003, 0.004, 0.005];

export function StakePanel({ roundId, phase, roundNumber, threshold, pool }: StakeProps) {
  const wallet = useBlockchainWallet();
  const betting = useBettingContract(roundNumber);
  const displayedPool = betting.pool ?? pool;
  const { pushTransaction, updateTransaction } = useTransactions();
  const [side, setSide] = useState<"under" | "over">("under");
  const [amount, setAmount] = useState("0.001");
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [backendSyncError, setBackendSyncError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const open = phase === "betting";
  const walletConnected = Boolean(wallet.address && wallet.connected);
  const wrongNetwork = walletConnected && !wallet.isCorrectNetwork;
  const insufficientEth = Number(amount) > wallet.balance;
  const alreadyBet = betting.hasBet;
  const loadingBetState = betting.loading;

  const total = displayedPool ? displayedPool.under + displayedPool.over : null;
  const underX = total !== null && displayedPool && displayedPool.under > 0 ? total / displayedPool.under : null;
  const overX = total !== null && displayedPool && displayedPool.over > 0 ? total / displayedPool.over : null;
  // RushBetting deducts protocolFeeBps from the whole pool, then distributes
  // claimablePool proportionally across the winning side.
  const protocolFeeBps = betting.protocolFeeBps ?? 1_000;
  const winningPool = betting.side === "OVER" ? displayedPool?.over : displayedPool?.under;
  const postFeePool = total === null ? null : (total * (10_000 - protocolFeeBps)) / 10_000;
  const lockedMultiplier = postFeePool !== null && winningPool && winningPool > 0
    ? postFeePool / winningPool
    : null;
  const lockedReturn = lockedMultiplier === null ? null : Number(betting.amountEth) * lockedMultiplier;

  const statusMessage = useMemo(() => {
    if (!walletConnected) return "Connect your wallet to place a bet.";
    if (wrongNetwork) return "Switch to the Robinhood network to continue.";
    if (!open) return "Betting is closed for this round.";
    if (alreadyBet) return "You already placed a bet for this round.";
    if (insufficientEth) return "Insufficient ETH balance.";
    return null;
  }, [walletConnected, wrongNetwork, open, alreadyBet, insufficientEth]);

  async function submit() {
    setSubmissionError(null);
    setBackendSyncError(null);

    if (!walletConnected) {
      setSubmissionError("Please connect your wallet before placing a bet.");
      return;
    }
    if (wrongNetwork) {
      setSubmissionError("Please switch to the Robinhood network.");
      return;
    }
    if (!open) {
      setSubmissionError("Betting has already closed for this round.");
      return;
    }
    if (alreadyBet) {
      setSubmissionError("Your active bet is already recorded on-chain.");
      return;
    }
    if (Number(amount) <= 0) {
      setSubmissionError("Enter an amount greater than 0.");
      return;
    }
    if (insufficientEth) {
      setSubmissionError("Your wallet does not have enough ETH for this bet.");
      return;
    }
    if (!wallet.signer) {
      setSubmissionError("Unable to prepare the transaction signer.");
      return;
    }

    setSubmitting(true);
    const transactionId = pushTransaction({
      title: "Bet processing",
      description: `${amount} ${ticker} ${side.toUpperCase()} — confirm in your wallet`,
      status: "Pending",
      explorerUrl: "",
    });

    try {
      const sideKey: BetSide = side === "under" ? "UNDER" : "OVER";

      console.debug("[StakePanel] submit() bet payload", {
        side,
        sideKey,
        amount,
        roundNumber,
        roundId,
        walletAddress: wallet.address,
        walletConnected,
        wrongNetwork,
        signerReady: Boolean(wallet.signer),
        providerReady: Boolean(wallet.provider),
        chainId: wallet.chainId,
        balance: wallet.balance,
      });

      const txHash = await betting.placeBet(sideKey, amount);
      console.debug("[StakePanel] writeContract returned tx hash", {
        txHash,
      });

      updateTransaction(transactionId, {
        title: `Bet ${sideKey}`,
        description: `${amount} ${ticker} ${sideKey} submitted`,
        explorerUrl: BettingContractService.getExplorerTxUrl(txHash),
      });

      if (!wallet.provider) {
        throw new Error("Wallet provider is not ready for transaction receipt confirmation.");
      }

      console.debug("[StakePanel] waiting for receipt", {
        txHash,
        provider: Boolean(wallet.provider),
        chainId: wallet.chainId,
      });

      const receipt = await wallet.provider.waitForTransactionReceipt({
        hash: txHash,
      });

      console.debug("[StakePanel] transaction receipt", receipt);

      updateTransaction(transactionId, {
        title: `Bet confirmed`,
        description: `Round ${roundNumber} ${sideKey} bet confirmed`,
        status: "Confirmed",
        explorerUrl: BettingContractService.getExplorerTxUrl(receipt.transactionHash),
      });

      try {
        // Use the authoritative current round id from the backend to avoid
        // syncing bets to an already-finished round (frontend clocks can be stale).
        const apiBase = import.meta.env["VITE_GAME_API_URL"] ?? "http://localhost:8000";
        let authoritativeRoundId = roundId;
        try {
          const r = await fetch(`${apiBase}/round/current`, { cache: "no-store" });
          if (r.ok) {
            const json = await r.json();
            if (json && json.round && json.round.id) {
              authoritativeRoundId = json.round.id;
              console.debug("[StakePanel] using authoritativeRoundId from backend", authoritativeRoundId);
            }
          } else {
            console.debug("[StakePanel] unable to fetch authoritative round id, falling back to prop", r.status);
          }
        } catch (err) {
          console.debug("[StakePanel] error fetching authoritative round id, falling back to prop", err);
        }

        await BetSyncService.syncTransaction({
          txHash: receipt.transactionHash,
          walletAddress: wallet.address,
          roundId: authoritativeRoundId,
          side: sideKey,
          amountEth: amount,
        });
        console.log("[StakePanel] backend sync succeeded");
      } catch (error) {
        console.error("[StakePanel] backend sync failed after tx receipt", error);
        setBackendSyncError((error as Error).message || "Unable to sync bet with backend.");
      }

      await betting.readUserBet();
      await betting.readPool();
    } catch (error) {
      console.error("[StakePanel] submit() transaction write failed", {
        error,
        message: (error as Error)?.message,
        side,
        amount,
        roundNumber,
        roundId,
        walletAddress: wallet.address,
        chainId: wallet.chainId,
        providerName: wallet.providerName,
        signerReady: Boolean(wallet.signer),
        providerReady: Boolean(wallet.provider),
      });

      const message = TransactionService.normalizeError(error);
      setSubmissionError(message);
      updateTransaction(transactionId, {
        title: "Bet failed",
        description: message,
        status: "Failed",
        explorerUrl: "",
      });
    } finally {
      setSubmitting(false);
    }
  }

  console.log(`Backend error: ${backendSyncError}, Submission error: ${submissionError}, Betting error: ${betting.error} Status message: ${statusMessage}`);

  return (
    <div className="panel border border-border/50 bg-surface-2/60 p-6">
      <div className="flex items-center justify-between">
        <p className="label-tech">Your position</p>
        <p className="font-mono text-xs text-muted-foreground">Round #{roundNumber}</p>
      </div>

      <p className="mt-1 font-display text-2xl">
        Threshold <span className="text-primary">{threshold}</span>
      </p>

      {alreadyBet ? (
        <div className="clip-tag mt-6 border border-primary/60 bg-primary/10 p-4">
          <div className="flex items-center space-x-2">
            <span>
              <Lock className="h-4 w-4 text-rose-400" />
            </span>
            <p className="label-tech text-primary">Position locked on-chain</p>
          </div>
          <p className="mt-2 font-display text-xl">
            {betting.amountEth} {ticker} · <span className={betting.side === "OVER" ? "text-emerald-500" : "text-rose-400"}>{betting.side}</span>
          </p>
          {/*lockedMultiplier !== null && lockedReturn !== null ? (
            <p className="mt-2 text-sm text-muted-foreground">
              If this side wins: <span className="font-mono text-primary">{lockedMultiplier.toFixed(2)}×</span>
              <span className="mx-1">·</span>
              estimated winning-pool share <span className="font-mono text-primary">{lockedReturn.toFixed(6)} {ticker}</span>
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">Payout estimate will appear once the round pool is available.</p>
          )*/}
          <p className="mt-1 text-xs text-muted-foreground">This ETH pool share is used to purchase stock rewards, not paid as a direct ETH withdrawal. It uses current pools after the {protocolFeeBps / 100}% protocol fee; final pools can change until betting closes.</p>
          <p className="mt-1 text-xs text-muted-foreground">Your bet is stored on the on-chain and will settle when the round closes.</p>
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3">
            {(["over", "under"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSide(s)}
                className={cn(
                  "clip-tag border p-4 text-left transition-colors",
                  side === s
                    ? s === "under"
                      ? "border-rose-400 bg-rose-400/15"
                      : "border-emerald-500 bg-emerald-500/15"
                    : "border-border bg-surface-2/60 hover:border-primary/50",
                )}
              >
                <div className="flex items-center gap-2">
                  {s === "under" ? <TrendingDown className="h-4 w-4 text-rose-400" /> : <TrendingUp className="h-4 w-4 text-emerald-500" />}
                  <span className="font-display text-md font-bold uppercase">{s}</span>
                </div>
                {/* pool details intentionally removed to simplify button UI */}
              </button>
            ))}
          </div>

          <BetSlip
            side={side}
            amount={amount}
            onAmountChange={setAmount}
            walletBalance={wallet.balance}
            potentialRush={betting.claimableRush}
            protocolFee={betting.protocolFee}
            onSubmit={submit}
            submitting={submitting}
            disabled={!open || submitting || loadingBetState || betting.poolLoading || wrongNetwork || alreadyBet || insufficientEth || !displayedPool}
            closed={!open}
            statusMessage={statusMessage}
            errorMessage={submissionError || backendSyncError || betting.error}
          />
          
        </>
      )}

      {!wallet.address && (
        <p className="mt-3 text-center font-mono text-xs text-muted-foreground">
          <Link to="/wallet" className="text-primary hover:underline">
            Connect a wallet
          </Link>{" "}
          to place an on-chain bet.
        </p>
      )}
    </div>
  );
}
