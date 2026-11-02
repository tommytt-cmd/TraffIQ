import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";

import { PhaseStatus } from "@/components/phase-status";
import { LiveStream } from "@/components/live-stream";
import { SectionHeading } from "@/components/panel";
import { StakePanel } from "@/components/stake-panel";
import { JUNCTION } from "@/lib/round";
import { useGameLoop } from "@/hooks/useGameLoop";

type RobinhoodQuote = {
  tokenSymbol: string;
  deployments?: Array<{ contractAddress: string; chainId: number }>;
  bid?: string;
  ask?: string;
  currency?: string;
  dailyTradingVolume?: string;
  isTradingHalt?: boolean;
  generatedAt?: string;
};

type RobinhoodPriceResponse = {
  quotes: RobinhoodQuote[];
};

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ElyRush — Live Vehicle Count Under/Over Markets" },
      {
        name: "description",
        content:
          "Stake under or over the vehicle threshold on live junction camera counts. Betting, locked, live and settling phases every three minutes.",
      },
      { property: "og:title", content: "ElyRush — Live Vehicle Count Under/Over Markets" },
      {
        property: "og:description",
        content:
          "Live traffic count markets: pick under or over the threshold and settle on verified camera data.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const loop = useGameLoop();
  const queryClient = useQueryClient();
  const PAGE_SIZE = 10;
  const [historyOffset, setHistoryOffset] = useState(0);
  const historyQuery = useQuery({
    queryKey: ["round-history", historyOffset],
    queryFn: async () => {
      const apiBase = import.meta.env["VITE_GAME_API_URL"] ?? "http://localhost:8000";
      const response = await fetch(`${apiBase}/api/game/history?limit=${PAGE_SIZE}&offset=${historyOffset}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load round history");
      return (await response.json()) as { items: Array<{ id: string; round_number: number; threshold: number | null; final: number; result: "over" | "under" | null }>; total: number; limit: number; offset: number };
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const history = historyQuery.data?.items ?? [];
  const historyTotal = historyQuery.data?.total ?? 0;
  const historyPage = Math.floor(historyOffset / PAGE_SIZE) + 1;
  const historyPageCount = Math.max(1, Math.ceil(historyTotal / PAGE_SIZE));

  /*
  const supportedStocksQuery = useQuery({
    queryKey: ["supported-stocks"],
    queryFn: async () => {
      const response = await fetch(
        `${import.meta.env["VITE_GAME_API_URL"] ?? "http://localhost:8000"}/api/stocks/supported`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Unable to load supported stocks");
      return response.json() as Promise<Array<{ address: string; symbol: string; name: string | null }>>;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const rhjAssetsQuery = useQuery({
    queryKey: ["rhj-assets"],
    queryFn: async () => {
      const res = await fetch("https://api.robinhood.com/rhj/assets", { cache: "no-store" });
      if (!res.ok) throw new Error("Unable to load RHJ assets");
      const j = await res.json();
      return (j.assets ?? []) as Array<any>;
    },
    staleTime: 60_000,
  });

  const rhjPricesQuery = useQuery({
    queryKey: ["rhj-prices", supportedStocksQuery.data?.map((s) => s.symbol)],
    enabled: !!supportedStocksQuery.data && supportedStocksQuery.data.length > 0,
    queryFn: async () => {
      const apiBase = import.meta.env["VITE_GAME_API_URL"] ?? "http://localhost:8000";
      const symbols = (supportedStocksQuery.data ?? []).map((s) => s.symbol);
      const results = await Promise.all(
        symbols.map(async (sym) => {
          const symNorm = sym.trim().toUpperCase();
          const url = `${apiBase}/api/stocks/prices/${encodeURIComponent(symNorm)}`;
          try {
            const res = await fetch(url, { cache: "no-store" });
            if (!res.ok) {
              const body = await res.text();
              console.error("Stock price request failed", { symbol: symNorm, status: res.status, body });
              return { symbol: symNorm, quote: null };
            }
            const j = await res.json();
            const q = j.quotes?.[0] ?? null;
            return { symbol: symNorm, quote: q };
          } catch (e) {
            console.error("Stock price fetch error", { symbol: symNorm, error: String(e) });
            return { symbol: symNorm, quote: null };
          }
        }),
      );
      return Object.fromEntries(results.map((r) => [r.symbol, r.quote]));
    },
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
  */

  const settledRoundNumberRef = useRef<number | null>(null);
  const previousRoundNumberRef = useRef<number>(loop.roundNumber);

  useEffect(() => {
    if (loop.phase === "settle" && loop.lastWinner !== null) {
      void queryClient.invalidateQueries({ queryKey: ["round-history"] });
      settledRoundNumberRef.current = loop.roundNumber;
    }

    if (loop.roundNumber !== previousRoundNumberRef.current) {
      void queryClient.invalidateQueries({ queryKey: ["round-history"] });
      previousRoundNumberRef.current = loop.roundNumber;
    }
  }, [loop.phase, loop.roundNumber, loop.lastWinner, queryClient]);

  const settleData = loop.phase === "settle" && loop.lastWinner ? loop.lastWinner : null;

  return (
    <div>
      <section className="relative border-b border-border">
        <div className="relative mx-auto max-w-7xl px-4 pt-8 pb-12 sm:px-6">
          <h1 className="mt-3 max-w-3xl text-2xl leading-[0.95] sm:text-6xl">
           {/* <span className="text-primary">Ely</span>Rush — */}Live vehicle-count prediction markets
          </h1>
          <p className="mt-4 max-w-md text-sm text-muted-foreground">
            Place under/over stakes on verified junction vehicle counts. Rounds are settled
            against the submitted result and on-chain rules. Winning positions receive the
            market payout based on the settlement outcome.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="#market"
              className="clip-tag bg-primary px-5 py-3 font-display text-xs font-bold uppercase tracking-[0.16em] text-primary-foreground"
            >
              View live market
            </a>
            <Link
              to="/how-it-works"
              className="clip-tag border border-primary/60 px-5 py-3 font-display text-xs font-bold uppercase tracking-[0.16em] text-primary"
            >
              How it works
            </Link>
          </div>
        </div>
      </section>

      <section aria-label="Demo notice" className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
        <div className="flex items-center gap-3 border border-warning/60 bg-warning/15 px-4 py-3 text-warning-foreground">
          <AlertTriangle className="h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.12em] sm:text-sm">
            Demo only.
          </p>
        </div>
      </section>

      <section id="market" className="mx-auto max-w-7xl px-4 py-2 sm:px-6">
        {loop.isLoading ? (
          <div className="panel flex min-h-[360px] items-center justify-center p-8 text-center">
            <div>
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
              <p className="label-tech mt-5 text-primary">Loading live round</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Waiting for the game backend to provide the current round data.
              </p>
            </div>
          </div>
        ) : (
          <>
            <PhaseStatus phase={loop.phase} remaining={loop.secondsLeft} totalForPhase={loop.totalForPhase} />

            <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
              <div className="grid gap-4 content-start">
                <LiveStream
                  phase={loop.phase}
                  settleData={settleData}
                  threshold={loop.threshold}
                  videoUrl={loop.videoUrl}
                  playbackTime={loop.playbackTime}
                  locationName={loop.locationName}
                  timelineEvents={loop.timelineEvents}
                />

                <div className="mt-1 flex items-start gap-2 max-w-xl text-sm text-muted-foreground">
                  <AlertTriangle className="h-4 w-4 text-warning mt-0.5" />
                  <span>AI counting can be inaccurate on low-light, occluded, or poor-weather footage</span>
                </div>
              </div>

              <StakePanel
                key={loop.roundId || loop.roundNumber}
                roundId={loop.roundId}
                phase={loop.phase}
                roundNumber={loop.roundNumber}
                threshold={loop.threshold}
                pool={loop.pool}
              />
            </div>
          </>
        )}

        <div className="mt-14">
          <SectionHeading eyebrow="Settled rounds" title="Recent settled rounds">
            Each round settles to the verified junction vehicle count. Results and settlement
            data are public and reproducible.
          </SectionHeading>
          <div className="panel mt-6 overflow-x-auto">
            <table className="w-full min-w-[320px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="label-tech px-4 py-3 text-primary-foreground">Round</th>
                  <th className="label-tech px-2 py-3 text-primary-foreground">Threshold</th>
                  <th className="label-tech px-2 py-3 text-primary-foreground">Final</th>
                  <th className="label-tech px-2 py-3 text-primary-foreground text-right">Result</th>
                </tr>
              </thead>
              <tbody>
                {historyQuery.isLoading ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">Loading history…</td></tr>
                ) : historyQuery.isError ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-destructive">Unable to load round history.</td></tr>
                ) : history.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">No settled rounds yet.</td></tr>
                ) : history.map((r) => (
                  <tr key={r.round_number} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      #{r.round_number.toString().slice(-6)}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm">{r.threshold ?? "—"}</td>
                    <td className="px-4 py-3 font-mono text-sm tabular-nums">{r.final}</td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={
                          r.result === "over"
                            ? "clip-tag bg-emerald-500/15 border border-emerald-500 transition-colors px-2 py-0.5 font-mono text-[0.625rem] uppercase"
                            : "clip-tag bg-rose-400/15 border border-rose-400 transition-colors px-2 py-0.5 font-mono text-[0.625rem] uppercase"
                        }
                      >
                        {r.result ?? "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 flex items-center justify-between gap-3 px-2">
              <button
                onClick={() => setHistoryOffset((offset) => Math.max(0, offset - PAGE_SIZE))}
                disabled={historyOffset === 0 || historyQuery.isFetching}
                className="clip-tag border border-primary px-4 py-2 text-sm text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <span className="font-mono text-xs text-muted-foreground">
                Page {historyPage} of {historyPageCount}
              </span>
              <button
                onClick={() => setHistoryOffset((offset) => offset + PAGE_SIZE)}
                disabled={historyOffset + PAGE_SIZE >= historyTotal || historyQuery.isFetching}
                className="clip-tag border border-primary px-4 py-2 text-sm text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>

        {/*
        <div className="mt-14">
          <SectionHeading eyebrow="Supported stocks" title="Supported Stock Tokens">
            Listed stock token assets and live quotes (raw underlying, not multiplier-adjusted).
          </SectionHeading>
          <div className="panel mt-6 overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="label-tech px-4 py-3">Asset</th>
                  <th className="label-tech px-2 py-3">Name</th>
                  <th className="label-tech px-2 py-3">Price</th>
                  <th className="label-tech px-2 py-3 text-right">View</th>
                </tr>
              </thead>
              <tbody>
                {supportedStocksQuery.isLoading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      Loading supported stocks…
                    </td>
                  </tr>
                ) : (supportedStocksQuery.data ?? []).map((stock) => {
                  const isPricesLoading = rhjPricesQuery.isLoading || (rhjPricesQuery.isFetching && !rhjPricesQuery.data);
                  const price = rhjPricesQuery.data?.[stock.symbol.toUpperCase()];
                  const asset = (rhjAssetsQuery.data ?? []).find((a: any) => a.tokenSymbol === stock.symbol);
                  const logoUrl = stock.address ? `https://cdn.robinhood.com/ncw_assets/logos/${stock.address.toLowerCase()}.png` : undefined;

                  return (
                    <tr key={stock.address} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-3 flex items-center gap-3">
                        {logoUrl ? (
                          <img src={logoUrl} alt={stock.symbol} className="h-6 w-6 rounded" />
                        ) : (
                          <div className="h-6 w-6 rounded bg-muted" />
                        )}
                        <div className="font-mono text-xs">{stock.symbol}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{stock.name ?? "—"}</td>
                      <td className="px-4 py-3 font-mono text-sm tabular-nums">$
                        {isPricesLoading ? (
                          <span className="text-muted-foreground animate-pulse">Loading…</span>
                        ) : price ? (
                          (() => {
                            const bid = parseFloat(price.bid ?? NaN);
                            const ask = parseFloat(price.ask ?? NaN);
                            const mid = Number.isFinite(bid) && Number.isFinite(ask)
                              ? ((bid + ask) / 2)
                              : Number.isFinite(bid) ? bid : Number.isFinite(ask) ? ask : null;

                            return mid !== null
                              ? mid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                              : "—";
                          })()
                        ) : (
                          <span className="text-destructive">Error</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {stock.address ? (
                          <a
                            href={`https://robinhoodchain.blockscout.com/address/${stock.address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary underline"
                          >
                            View asset
                          </a>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}

              </tbody>
            </table>
          </div>
        </div>
        */}

        {/*<div className="mt-14">
          <SectionHeading eyebrow="How it works" title="The market flow">
            Rounds open to participants, settle against the verified count, and resolve based on the final on-chain result.
          </SectionHeading>
        </div>*/}
      </section>
    </div>
  );
}
