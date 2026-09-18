import { useEffect, useRef } from "react";
import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
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
      { title: "TRAFFIQ — Live Vehicle Count Under/Over Markets" },
      {
        name: "description",
        content:
          "Stake under or over the vehicle threshold on live junction camera counts. Betting, locked, live and settling phases every three minutes.",
      },
      { property: "og:title", content: "TRAFFIQ — Live Vehicle Count Under/Over Markets" },
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
  const historyQuery = useInfiniteQuery({
    queryKey: ["round-history"],
    queryFn: async ({ pageParam = 0 }) => {
      const apiBase = import.meta.env["VITE_GAME_API_URL"] ?? "http://localhost:8000";
      const response = await fetch(`${apiBase}/api/game/history?limit=${PAGE_SIZE}&offset=${pageParam}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load round history");
      return (await response.json()) as { items: Array<{ id: string; round_number: number; threshold: number | null; final: number; result: "over" | "under" | null }>; total: number; limit: number; offset: number };
    },
    getNextPageParam: (lastPage) => {
      const next = lastPage.offset + lastPage.limit;
      return next < lastPage.total ? next : undefined;
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
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
              // Preserve error details for debugging
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

  const history = (historyQuery.data?.pages ?? []).flatMap((p) => {
    if (Array.isArray(p)) return p as Array<any>;
    if (p && Array.isArray((p as any).items)) return (p as any).items as Array<any>;
    return [] as Array<any>;
  }) ?? [];
  const settleData = loop.phase === 'settle' && loop.lastWinner ? loop.lastWinner : null;

  //const viewportVehicleCount = loop.phase === 'live' ? liveVehicleCount : loop.vehicleCount;

  return (
    <div>
      {/* HERO */}
      <section className="relative border-b border-border">
        <div className="relative mx-auto max-w-7xl px-4 pt-8 pb-12 sm:px-6">
          <h1 className="mt-3 max-w-3xl text-4xl leading-[0.95] sm:text-6xl">
              Traff<span className="text-primary ">I<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 300" fill="none" className="inline-block -mt-1 w-[28px] h-[37px] sm:w-[47px] sm:h-[58px]">
                        <path d=" M 65 20 H 155 C 190 20 205 40 205 75 V 215 C 205 250 190 270 155 270 H 65 C 30 270 15 250 15 215 V 75 C 15 40 30 20 65 20 Z M 65 65 C 52 65 45 72 45 85 V 205 C 45 218 52 225 65 225 H 155 C 168 225 175 218 175 205 V 85 C 175 72 168 65 155 65 Z " fill="#A8FF19" fill-rule="evenodd" />
                        <path d=" M 145 225 L 205 285 L 175 315 L 115 255 Z " fill="#A8FF19" />
                        <rect x="75" y="85" width="70" height="130" rx="16" fill="#050807" />
                        <rect x="68" y="98" width="88" height="18" rx="14" fill="#FF315D" />
                        <rect x="68" y="136" width="88" height="18" rx="14" fill="#FFC84A" />
                        <rect x="68" y="174" width="88" height="18" rx="14" fill="#49C99B" />
                      </svg>
                    </span> — Live vehicle-count prediction markets
          </h1>
          <p className="mt-4 max-w-md text-sm text-muted-foreground">
            Place under/over stakes on verified junction vehicle counts. Rounds are settled
            against the submitted result and on-chain rules. Winning positions receive a pro-rata
            share of the stock tokens bought for their market.
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
          {/*<div className="mt-6 max-w-2xl">
            <p className="label-tech">Supported stock rewards</p>
            {supportedStocksQuery.isLoading ? (
              <p className="mt-2 text-sm text-muted-foreground">Loading supported stocks…</p>
            ) : supportedStocksQuery.data && supportedStocksQuery.data.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {supportedStocksQuery.data.map((stock) => (
                  <span
                    key={stock.address}
                    title={stock.name ?? stock.symbol}
                    className="clip-tag border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-xs text-primary"
                  >
                    {stock.symbol}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                Supported stock rewards will appear here once they are available.
              </p>
            )}
          </div>*/}
        </div>
      </section>

      {/* LIVE MARKET */}
      <section id="market" className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
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
              //vehicleCount={viewportVehicleCount}
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

            {/*<div className="grid gap-4 sm:grid-cols-3" />*/}
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

        {/* HISTORY */}
        <div className="mt-14">
            <SectionHeading eyebrow="Settled rounds" title="Recent settled rounds">
            Each round settles to the verified junction vehicle count. Results and settlement
            data are public and reproducible.
          </SectionHeading>
          <div className="panel mt-6 overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="label-tech px-4 py-3">Round</th>
                  <th className="label-tech px-2 py-3">Threshold</th>
                  <th className="label-tech px-2 py-3">Final</th>
                  <th className="label-tech px-2 py-3 text-right">Result</th>
                </tr>
              </thead>
              <tbody>
                {historyQuery.isLoading ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">Loading history…</td></tr>
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
            <div className="mt-3 flex justify-center">
              {historyQuery.hasNextPage ? (
                <button onClick={() => void historyQuery.fetchNextPage()} className="clip-tag border border-primary px-4 py-2 text-sm text-primary">Load more</button>
              ) : (
                <span className="text-sm text-muted-foreground">End of history</span>
              )}
            </div>
          </div>
        </div>

        {/* Stock */}
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
                  // Check if prices are still loading for the first time
                  const isPricesLoading = rhjPricesQuery.isLoading || (rhjPricesQuery.isFetching && !rhjPricesQuery.data);
                  const price = rhjPricesQuery.data?.[stock.symbol.toUpperCase()];
                  const asset = (rhjAssetsQuery.data ?? []).find((a: any) => a.tokenSymbol === stock.symbol);
                  const logoUrl = stock.address ? `https://cdn.robinhood.com/ncw_assets/logos/${stock.address.toLowerCase()}.png` : undefined;

                  return (
                    <tr key={stock.address} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-3 flex items-center gap-3">
                        {logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
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


        {/* Demo notice removed for production */}
      </section>
    </div>
  );
}
