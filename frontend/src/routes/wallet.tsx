import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { formatUnits, type Address } from "viem";
import { Copy, LogOut, Wallet as WalletIcon } from "lucide-react";
import { toast } from "sonner";

import { Panel, SectionHeading } from "@/components/panel";
import { useWallet } from "@/hooks/useWallet";
import { shortAddress } from "@/lib/round";
import { BettingContractService } from "@/services/blockchain/bettingContractService";
import { DEFAULT_EXPLORER_URL } from "@/services/blockchain/constants";

type TokenReward = { token: Address; symbol: string; decimals: number; entitled: bigint; alreadyClaimed: bigint; claimable: bigint };
type RewardRound = { roundNumber: bigint; contribution: bigint; entitled: bigint; gross: bigint; claimed: boolean; created: boolean; finalized: boolean; settled: boolean; winningSide: string; tokens: TokenReward[] };
type Bet = { roundNumber: bigint; side: string; amount: bigint };
type ClaimState = "preparing" | "confirming" | "pending";

const erc20MetadataAbi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

export const Route = createFileRoute("/wallet")({ head: () => ({ meta: [{ title: "Wallet — TRAFFIC" }] }), component: WalletPage });

function WalletPage() {
  const wallet = useWallet();
  const [bets, setBets] = useState<Bet[]>([]);
  const [rewards, setRewards] = useState<RewardRound[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<Record<string, ClaimState>>({});

  const refresh = useCallback(async () => {
    if (!wallet.provider || !wallet.address) { setBets([]); setRewards([]); return; }
    setLoading(true); setError(null);
    try {
      const [history, rawRewards] = await Promise.all([
        BettingContractService.getBetHistory(wallet.provider, wallet.address as Address, 75),
        BettingContractService.getStockRewardHistory(wallet.provider, wallet.address as Address, 75),
      ]);
      const enriched = await Promise.all((rawRewards as RewardRound[]).map(async (round) => ({
        ...round,
        tokens: await Promise.all(round.tokens.map(async (token) => {
          const [symbol, decimals] = await Promise.all([
            wallet.provider!.readContract({ address: token.token, abi: erc20MetadataAbi, functionName: "symbol" }).catch(() => shortAddress(token.token)),
            wallet.provider!.readContract({ address: token.token, abi: erc20MetadataAbi, functionName: "decimals" }).catch(() => 18),
          ]);
          return { ...token, symbol: String(symbol), decimals: Number(decimals) };
        })),
      })));
      setBets(history); setRewards(enriched);
    } catch (caught) { setError((caught as Error).message || "Unable to load wallet activity."); }
    finally { setLoading(false); }
  }, [wallet.address, wallet.provider]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function claim(roundId: bigint, token: TokenReward) {
    if (!wallet.signer || !wallet.provider || !wallet.isCorrectNetwork) return;
    const key = `${roundId}-${token.token}`;
    setClaiming((items) => ({ ...items, [key]: "preparing" }));
    try {
      setClaiming((items) => ({ ...items, [key]: "confirming" }));
      const hash = await BettingContractService.claimStockOnVault(wallet.signer, Number(roundId), token.token);
      setClaiming((items) => ({ ...items, [key]: "pending" }));
      await wallet.provider.waitForTransactionReceipt({ hash });
      const explorer = `${DEFAULT_EXPLORER_URL}/tx/${hash}`;
      toast.success(`${token.symbol} claimed for Round #${roundId}.`, { action: { label: "View transaction", onClick: () => window.open(explorer, "_blank", "noopener,noreferrer") } });
      await refresh();
    } catch (caught) { toast.error((caught as Error).message || "Unable to claim this stock reward."); }
    finally { setClaiming((items) => { const { [key]: _, ...remaining } = items; return remaining; }); }
  }

  async function switchNetwork() {
    const expected = Number(import.meta.env.VITE_ROBINHOOD_CHAIN_ID ?? 4663);
    const chainIdHex = `0x${expected.toString(16)}`;
    try {
      if (!(window as any).ethereum) throw new Error("No injected wallet");
      await (window as any).ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
      toast.success("Switched network in wallet.");
      return true;
    } catch (err: any) {
      // 4902 = chain not added to wallet
      if (err?.code === 4902) {
        // attempt to add chain (best-effort)
        try {
          await (window as any).ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: chainIdHex,
              chainName: "Robinhood Mainnet",
              nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
              rpcUrls: [import.meta.env.VITE_ROBINHOOD_RPC ?? "https://rpc.mainnet.chain.robinhood.com"],
            }],
          });
          toast.success("Added and switched to the supported network.");
          return true;
        } catch (addErr: any) {
          toast.error(addErr?.message || "Unable to add network to wallet.");
          return false;
        }
      }
      toast.error(err?.message || "Unable to switch network.");
      return false;
    }
  }

  if (!wallet.address) return <DisconnectedWallet />;

  const winningSideByRound = new Map(rewards.map((reward) => [reward.roundNumber.toString(), reward.winningSide]));
  const finalizedByRound = new Map(rewards.map((reward) => [reward.roundNumber.toString(), reward.finalized]));
  const getBetResult = (bet: Bet) => {
    const isFinalized = finalizedByRound.get(bet.roundNumber.toString());
    // If round is not in rewards data, assume it's finalized and check winning side
    // (rounds appear in bet history only after they're settled)
    if (isFinalized === undefined) {
      const winningSide = winningSideByRound.get(bet.roundNumber.toString());
      if (!winningSide) return "No stock reward";
      return winningSide === bet.side ? "Won" : "Lost";
    }
    if (!isFinalized) return "Pending";
    const winningSide = winningSideByRound.get(bet.roundNumber.toString());
    if (!winningSide) return "No stock reward";
    return winningSide === bet.side ? "Won" : "Lost";
  };

  const wins = bets.filter((bet) => getBetResult(bet) === "Won").length;
  const losses = bets.filter((bet) => getBetResult(bet) === "Lost").length;
  const totalWagered = bets.reduce((sum, bet) => sum + bet.amount, 0n);
  return <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
    <p className="label-tech">Account</p><h1 className="mt-3 text-4xl leading-[0.95] sm:text-5xl">Wallet</h1>
    <p className="mt-4 max-w-2xl text-sm text-muted-foreground">Your betting activity and stock rewards are tied directly to this connected wallet.</p>
    <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <Panel><p className="label-tech text-primary">Connected wallet</p><p className="mt-3 font-mono text-xl">{shortAddress(wallet.address)}</p><p className="mt-2 break-all font-mono text-xs text-muted-foreground">{wallet.address}</p><p className="label-tech mt-7">ETH balance</p><p className="mt-2 font-display text-4xl text-primary">{Number(wallet.nativeBalance).toFixed(4)} <span className="text-base text-muted-foreground">ETH</span></p><div className="mt-6 flex flex-wrap gap-3"><button onClick={() => { void navigator.clipboard.writeText(wallet.address!); toast.success("Wallet address copied."); }} className="clip-tag inline-flex items-center gap-2 border border-border px-3 py-2 font-display text-xs uppercase"><Copy className="h-3.5 w-3.5" />Copy address</button><button onClick={() => void wallet.disconnect()} className="clip-tag inline-flex items-center gap-2 border border-destructive/60 px-3 py-2 font-display text-xs uppercase text-destructive"><LogOut className="h-3.5 w-3.5" />Disconnect</button></div></Panel>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Stat label="Total bets" value={String(bets.length)} /><Stat label="Wins" value={String(wins)} /><Stat label="Losses" value={String(losses)} /><Stat label="Win rate" value={bets.length - wins - losses > 0 ? `${Math.round((wins / (bets.length - (bets.length - wins - losses))) * 100)}%` : bets.length > 0 ? `${Math.round((wins / bets.length) * 100)}%` : "—"} /><Stat label="Total wagered" value={`${amount(totalWagered, 18)} ETH`} /><Stat label="Stock rounds" value={String(rewards.length)} /></div>
    </div>
    <section className="mt-12"><SectionHeading eyebrow="On-chain rewards" title="Stock rewards">Each reward belongs to its original round and is claimed separately from the StockVault.</SectionHeading>
      {!wallet.isCorrectNetwork ? <Panel className="mt-6"><p className="text-sm text-destructive">Switch to the supported network to view and claim stock rewards.</p><div className="mt-4"><button onClick={() => void switchNetwork()} className="clip-tag border border-primary px-3 py-2 text-sm text-primary">Switch network</button></div></Panel> : loading ? <Panel className="mt-6">Loading reward rounds…</Panel> : error ? <Panel className="mt-6"><p className="text-sm text-destructive">{error}</p><button onClick={() => void refresh()} className="mt-4 text-sm text-primary">Try again</button></Panel> : rewards.length === 0 ? <Panel className="mt-6"><p className="text-sm text-muted-foreground">No eligible stock reward rounds yet. Winning rounds will appear here once the stock reward flow is available.</p></Panel> : <Panel className="mt-6 overflow-x-auto p-0">
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="label-tech px-5 py-4">Round</th>
              <th className="label-tech px-5 py-4">Side</th>
              <th className="label-tech px-5 py-4">Contribution</th>
              <th className="label-tech px-5 py-4">Status</th>
              <th className="label-tech px-5 py-4">Stock rewards</th>
            </tr>
          </thead>
          <tbody>
            {rewards.map((round) => {
              const status = !round.created || !round.settled ? "Reward pending" : !round.finalized ? "Stock reward pending" : round.gross > 0n ? round.claimed ? "Partially claimed" : "Reward available" : round.entitled > 0n ? "Claimed" : "No claimable reward";
              return (
                <tr key={round.roundNumber.toString()} className="border-b border-border/60 last:border-0">
                  <td className="px-5 py-4 font-mono">#{round.roundNumber.toString()}</td>
                  <td className="px-5 py-4">{round.winningSide}</td>
                  <td className="px-5 py-4 font-mono">{amount(round.contribution, 18)} ETH</td>
                  <td className="px-5 py-4">
                    <span className={`clip-tag border px-2 py-1 font-mono text-[0.65rem] uppercase ${
                      status === "Reward available" ? "border-primary/50 bg-primary/10 text-primary" :
                      status === "Partially claimed" ? "border-primary/50 bg-primary/10 text-primary" :
                      status === "Claimed" ? "border-border bg-surface-2/60 text-muted-foreground" :
                      "border-amber-500/50 bg-amber-50/60 text-amber-700"
                    }`}>
                      {status}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    {round.tokens.length === 0 ? (
                      <span className="text-xs text-muted-foreground">{round.finalized ? "—" : "Pending"}</span>
                    ) : (
                      <div className="space-y-2">
                        {round.tokens.map((token) => {
                          const state = claiming[`${round.roundNumber}-${token.token}`];
                          const label = state === "preparing" ? "Preparing…" : state === "confirming" ? "Confirm in wallet" : state === "pending" ? "Claiming…" : token.claimable > 0n ? "Claim" : "Claimed ✓";
                          return (
                            <div key={token.token} className="flex items-center justify-between gap-3">
                              <span className="text-xs text-muted-foreground">
                                {token.symbol} <span className="text-primary">{amount(token.claimable, token.decimals)}</span>
                              </span>
                              <button
                                disabled={!round.finalized || token.claimable === 0n || Boolean(state)}
                                onClick={() => void claim(round.roundNumber, token)}
                                className="clip-tag border border-primary px-2 py-1 font-display text-xs uppercase text-primary disabled:opacity-40"
                              >
                                {label}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>}
    </section>
    <section className="mt-12">
      <SectionHeading eyebrow="Betting activity" title="Round history">Recent positions from your connected wallet.</SectionHeading>
      <Panel className="mt-6 overflow-x-auto p-0">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="label-tech px-5 py-4">Round</th>
              <th className="label-tech px-5 py-4">Side</th>
              <th className="label-tech px-5 py-4">Wager</th>
              <th className="label-tech px-5 py-4 text-right">Result</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">Loading betting history…</td>
              </tr>
            ) : bets.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">No bets found for this wallet.</td>
              </tr>
            ) : (
              bets.map((bet) => {
                const result = getBetResult(bet);
                return (
                  <tr key={bet.roundNumber.toString()} className="border-b border-border/60 last:border-0">
                    <td className="px-5 py-4 font-mono">#{bet.roundNumber.toString()}</td>
                    <td className="px-5 py-4">{bet.side}</td>
                    <td className="px-5 py-4 font-mono">{amount(bet.amount, 18)} ETH</td>
                    <td className="px-5 py-4 text-right">
                      {result === "Won" ? (
                        <span className="clip-tag border border-primary/60 bg-primary/10 px-2 py-1 font-mono text-xs text-primary">Won</span>
                      ) : result === "Pending" ? (
                        <span className="rounded-2xl bg-amber-50 px-2 py-1 font-mono text-xs text-amber-700">Pending</span>
                      ) : result === "Lost" ? (
                        <span className="rounded-2xl bg-rose-50 px-2 py-1 font-mono text-xs text-rose-700">Lost</span>
                      ) : (
                        <span className="font-mono text-xs text-muted-foreground">No stock reward</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Panel>
    </section>
  </div>;
}

function Stat({ label, value }: { label: string; value: string }) { return <Panel className="border border-border bg-surface-2/60"><p className="label-tech">{label}</p><p className="mt-3 font-mono text-2xl text-primary">{value}</p></Panel>; }
function amount(value: bigint, decimals: number) { const parsed = Number(formatUnits(value, decimals)); return Number.isFinite(parsed) ? parsed.toLocaleString(undefined, { maximumFractionDigits: 6 }) : formatUnits(value, decimals); }
function DisconnectedWallet() { return <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6"><Panel><WalletIcon className="h-7 w-7 text-primary" /><p className="label-tech mt-5">Wallet</p><h1 className="mt-3 text-4xl leading-[0.95] sm:text-5xl">Connect your wallet</h1><p className="mt-4 max-w-xl text-sm text-muted-foreground">Connect a wallet to view your balance, betting history, and stock rewards by round.</p></Panel></div>; }
