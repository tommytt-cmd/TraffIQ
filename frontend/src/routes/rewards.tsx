import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { formatUnits, parseUnits, type Address } from "viem";
import { toast } from "sonner";
import { Panel, SectionHeading } from "@/components/panel";
import { useWallet } from "@/hooks/useWallet";
import { useBettingContract } from "@/hooks/useBettingContract";
import { BettingContractService } from "@/services/blockchain/bettingContractService";
import { TransactionService } from "@/services/blockchain/transactionService";

export const Route = createFileRoute("/rewards")({ component: RewardsPage });

function RewardsPage() {
  const wallet = useWallet();
  const betting = useBettingContract();
  const [position, setPosition] = useState({ vault: null as Address | null, shares: 0n, pending: 0n, gross: 0n, fee: 0n, net: 0n, wallet: 0n });
  const [sharesInput, setSharesInput] = useState("");
  const [preview, setPreview] = useState<[bigint, bigint, bigint]>([0n, 0n, 0n]);
  const [pending, setPending] = useState<"claim" | "withdraw" | "all" | null>(null);
  const [history, setHistory] = useState<Array<{ roundNumber: bigint; gross: bigint; claimed: boolean; staked: boolean; buyback: bigint }>>([]);
  const [historyState, setHistoryState] = useState<"idle" | "loading" | "error">("idle");
  const [claimingRound, setClaimingRound] = useState<bigint | null>(null);

  const refresh = useCallback(async () => {
    if (!wallet.provider || !wallet.address) return;
    const p = await BettingContractService.getHolderPosition(wallet.provider, wallet.address as Address);
    const walletRush = await BettingContractService.getRushWalletBalance(wallet.provider, wallet.address as Address);
    setPosition({ vault: p.holderVaultAddress ?? null, shares: p.shares, pending: p.pendingRewards, gross: p.grossAmount, fee: p.feeAmount, net: p.netAmount, wallet: walletRush });
    setHistoryState("loading");
    try { setHistory(await BettingContractService.getRushRewardHistory(wallet.provider, wallet.address as Address)); setHistoryState("idle"); }
    catch { setHistory([]); setHistoryState("error"); }
  }, [wallet.provider, wallet.address]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!position.vault || !wallet.provider || !sharesInput) { setPreview([0n, 0n, 0n]); return; }
    try {
      const shares = parseUnits(sharesInput, 18);
      if (shares > position.shares) { setPreview([0n, 0n, 0n]); return; }
      void BettingContractService.previewRushWithdraw(wallet.provider, position.vault, shares).then(setPreview).catch(() => setPreview([0n, 0n, 0n]));
    } catch { setPreview([0n, 0n, 0n]); }
  }, [sharesInput, position.vault, position.shares, wallet.provider]);

  async function submit(kind: "claim" | "withdraw" | "all") {
    if (!wallet.signer || !wallet.provider || !position.vault || !wallet.isCorrectNetwork) return;
    setPending(kind);
    try {
      const hash = kind === "claim" ? await BettingContractService.claimHolderRewards(wallet.signer, position.vault) : kind === "all" ? await BettingContractService.withdrawAllRush(wallet.signer, position.vault) : await BettingContractService.withdrawRush(wallet.signer, position.vault, parseUnits(sharesInput, 18));
      await wallet.provider.waitForTransactionReceipt({ hash });
      toast.success(kind === "claim" ? "Holder rewards claimed." : "ElyRush withdrawal confirmed.");
      setSharesInput(""); await refresh(); await betting.readClaimState();
    } catch (error) { toast.error(TransactionService.normalizeError(error)); }
    finally { setPending(null); }
  }

  async function claimRoundReward(roundNumber: bigint) {
    if (!wallet.provider || !wallet.isCorrectNetwork) return;
    setClaimingRound(roundNumber);
    try {
      const hash = await betting.claimRushRewardStake(Number(roundNumber));
      await wallet.provider.waitForTransactionReceipt({ hash });
      toast.success(`Round #${roundNumber.toString()} ElyRush was added to your staking position.`);
      await refresh();
      await betting.readClaimState();
    } catch (error) {
      toast.error(TransactionService.normalizeError(error));
    } finally {
      setClaimingRound(null);
    }
  }

  const elyRush = (value: bigint) => `${formatUnits(value, 18)} ElyRush`;
  const validShares = preview[0] > 0n && !!sharesInput;
  return <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
    <p className="label-tech">Rewards center</p><h1 className="mt-3 text-4xl sm:text-5xl">ElyRush Rewards</h1>
    <p className="mt-4 max-w-2xl text-muted-foreground">Round ElyRush rewards are automatically staked when claimed. Wallet ElyRush and staked ElyRush remain separate.</p>
    {!wallet.connected || !wallet.isCorrectNetwork ? <Panel className="mt-8"><p className="font-mono text-sm text-destructive">{wallet.connected ? "Wrong Network — switch to the supported network." : "Connect a wallet to view your rewards."}</p></Panel> : <>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[["Wallet ElyRush", elyRush(position.wallet)], ["Staked ElyRush", elyRush(position.gross)], ["Staking Shares", formatUnits(position.shares, 18)], ["Pending Holder Rewards", elyRush(position.pending)]].map(([label, value]) => <Panel key={label}><p className="label-tech">{label}</p><p className="mt-3 font-mono text-xl text-primary">{value}</p></Panel>)}
      </div>
      <div className="mt-10 grid gap-6 lg:grid-cols-2"><Panel><SectionHeading eyebrow="Holder rewards" title="Claim fee-free RUSH" /><p className="mt-3 text-sm text-muted-foreground">Holder rewards are separate from round rewards and have no withdrawal fee.</p><button onClick={() => void submit("claim")} disabled={position.pending === 0n || pending !== null} className="clip-tag mt-5 border border-primary px-4 py-3 font-display text-xs uppercase text-primary disabled:opacity-40">{pending === "claim" ? "Confirming…" : "Claim Holder Rewards"}</button></Panel>
      <Panel><SectionHeading eyebrow="Round RUSH" title="Automatic staking" /><p className="mt-3 text-sm text-muted-foreground">Claimable round RUSH: <span className="font-mono text-primary">{betting.claimableRush} RUSH</span></p><p className="mt-2 text-xs text-muted-foreground">Claim an eligible settled round below to convert its ElyRush reward into staking shares. ElyRush stays in protocol custody until you withdraw your shares.</p></Panel></div>
      <Panel className="mt-6"><SectionHeading eyebrow="Withdraw staked RUSH" title="Preview before withdrawing" /><div className="mt-5 grid gap-4 md:grid-cols-[1fr_auto]"><input value={sharesInput} onChange={(event) => setSharesInput(event.target.value)} placeholder="Shares to withdraw" inputMode="decimal" className="border border-input bg-background px-3 py-3 font-mono" /><button onClick={() => setSharesInput(formatUnits(position.shares, 18))} className="clip-tag border border-border px-4 py-3 font-display text-xs uppercase">Max shares</button></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><p>Gross <span className="font-mono text-primary">{rush(preview[0])}</span></p><p>Fee <span className="font-mono text-destructive">{rush(preview[1])}</span></p><p>Net <span className="font-mono text-primary">{rush(preview[2])}</span></p></div><div className="mt-6 flex flex-wrap gap-3"><button disabled={!validShares || pending !== null} onClick={() => void submit("withdraw")} className="clip-tag bg-primary px-4 py-3 font-display text-xs uppercase text-primary-foreground disabled:opacity-40">{pending === "withdraw" ? "Confirming…" : "Withdraw RUSH"}</button><button disabled={position.shares === 0n || pending !== null} onClick={() => void submit("all")} className="clip-tag border border-primary px-4 py-3 font-display text-xs uppercase text-primary disabled:opacity-40">{pending === "all" ? "Confirming…" : "Withdraw All"}</button></div></Panel>
      <Panel className="mt-6"><SectionHeading eyebrow="On-chain rewards" title="ElyRush Reward History" />{historyState === "loading" ? <p className="mt-4 text-sm text-muted-foreground">Loading recent rounds…</p> : historyState === "error" ? <p className="mt-4 text-sm text-destructive">Unable to load reward history. Try refreshing.</p> : history.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No ElyRush rewards yet. Win a round to earn ElyRush rewards that can be staked here.</p> : <div className="mt-5 space-y-3">{history.map((entry) => <div key={entry.roundNumber.toString()} className="clip-tag grid gap-3 border border-border p-3 text-sm sm:grid-cols-[1fr_1fr_1fr_auto]"><span className="font-mono">Round #{entry.roundNumber.toString()}</span><span>Gross: <b className="font-mono text-primary">{rush(entry.gross)}</b></span><span>{entry.staked ? "Staked" : "Claimable"}</span>{!entry.staked && entry.gross > 0n ? <button onClick={() => void claimRoundReward(entry.roundNumber)} disabled={claimingRound !== null} className="clip-tag border border-primary px-3 py-2 font-display text-xs uppercase text-primary disabled:opacity-40">{claimingRound === entry.roundNumber ? "Confirming…" : "Stake reward"}</button> : <span className="font-mono text-xs text-muted-foreground">Buyback: {rush(entry.buyback)}</span>}</div>)}</div>}<p className="mt-4 text-xs text-muted-foreground">Recent 25 rounds. Transaction metadata is shown by your connected wallet/explorer after confirmation; no off-chain reward database is used.</p></Panel>
    </>}</div>;
}
