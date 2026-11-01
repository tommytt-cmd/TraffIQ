import { useEffect, useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AreaChart, Area, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, ArrowRight, Clock3, ShieldCheck } from "lucide-react";

import { Panel, SectionHeading } from "@/components/panel";
import { useWallet } from "@/hooks/useWallet";
import { shortAddress } from "@/lib/round";

const env = import.meta.env as Record<string, string | undefined>;
const GAME_API_BASE = env["VITE_GAME_API_URL"] ?? "http://localhost:8000";

const buildUrl = (path: string, walletAddress: string) =>
  `${GAME_API_BASE}${path}?wallet_address=${encodeURIComponent(walletAddress)}`;

const fetchJson = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.detail ?? data?.message ?? "Unable to load profile data");
  }

  return data;
};

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profile — ElyRush Player Activity" },
      {
        name: "description",
        content:
          "View your ElyRush activity, betting history, achievements, and market stats from your connected wallet.",
      },
      { property: "og:title", content: "Profile — ElyRush Player Activity" },
      {
        property: "og:description",
        content: "Access your betting history, win rate, recent activity and profile summary for your connected wallet.",
      },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const walletAddress = wallet.address?.toLowerCase() ?? "";
  const enabled = Boolean(walletAddress);

  const profileQueryKey = ["profile", walletAddress] as const;
  const statsQueryKey = ["profile", "stats", walletAddress] as const;
  const historyQueryKey = ["profile", "history", walletAddress] as const;
  const achievementsQueryKey = ["profile", "achievements", walletAddress] as const;

  const profileQuery = useQuery({
    queryKey: profileQueryKey,
    queryFn: () => fetchJson(buildUrl("/api/v1/profile", walletAddress)),
    enabled,
    staleTime: 1000 * 60,
  });

  const statsQuery = useQuery({
    queryKey: statsQueryKey,
    queryFn: () => fetchJson(buildUrl("/api/v1/profile/stats", walletAddress)),
    enabled,
    staleTime: 1000 * 60,
  });

  const historyQuery = useQuery({
    queryKey: historyQueryKey,
    queryFn: () => fetchJson(buildUrl("/api/v1/profile/history", walletAddress)),
    enabled,
    staleTime: 1000 * 60,
  });

  const achievementsQuery = useQuery({
    queryKey: achievementsQueryKey,
    queryFn: () => fetchJson(buildUrl("/api/v1/profile/achievements", walletAddress)),
    enabled,
    staleTime: 1000 * 60,
  });

  useEffect(() => {
    if (!walletAddress) {
      return;
    }

    queryClient.invalidateQueries(profileQueryKey);
  }, [queryClient, profileQueryKey]);

  const summary = profileQuery.data;
  const stats = statsQuery.data ?? [];
  const history = historyQuery.data ?? [];
  const achievements = achievementsQuery.data ?? [];

  const chartData = useMemo(
    () =>
      stats.map((point: any, index: number) => ({
        name: point.label,
        profit: point.profit,
        wins: point.wins,
        losses: point.losses,
      })),
    [stats],
  );

  const statsLoading = [profileQuery, statsQuery, historyQuery, achievementsQuery].some(
    (query) => query.isLoading,
  );

  if (!wallet.address) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <Panel>
          <p className="label-tech">Profile</p>
          <h1 className="mt-3 text-4xl leading-[0.95] sm:text-5xl">Connect your wallet</h1>
          <p className="mt-4 text-sm text-muted-foreground">
            Your profile data is powered by your connected wallet. Connect a wallet to view stats,
            history, and achievements.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Wallet connection required
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
      <div className="mb-10 grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <div>
          <p className="label-tech">Profile</p>
          <h1 className="mt-3 text-4xl leading-[0.95] sm:text-5xl">Wallet activity</h1>
          <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
            Review your recent bets, win rate, and live stats for the connected wallet address.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Panel className="border border-border bg-surface-2/60">
            <p className="label-tech">Connected address</p>
            <p className="mt-2 font-mono text-lg text-primary">{shortAddress(wallet.address)}</p>
            <p className="mt-3 text-sm text-muted-foreground break-all">{wallet.address}</p>
          </Panel>
          <Panel className="border border-border bg-surface-2/60">
            <p className="label-tech">Activity</p>
            <p className="mt-2 text-lg text-foreground">
              {profileQuery.data ? profileQuery.data.total_bets : "—"} bets placed
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              {profileQuery.data ? `${profileQuery.data.win_rate}% win rate` : "Loading stats..."}
            </p>
          </Panel>
        </div>
      </div>

      {statsLoading ? (
        <Panel>Loading profile data…</Panel>
      ) : summary ? (
        <div className="grid gap-6">
          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <Panel className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-3xl border border-border bg-background/80 p-5">
                  <p className="label-tech">Total staked</p>
                  <p className="mt-2 text-3xl font-semibold">{summary.total_staked}</p>
                </div>
                <div className="rounded-3xl border border-border bg-background/80 p-5">
                  <p className="label-tech">Win rate</p>
                  <p className="mt-2 text-3xl font-semibold">{summary.win_rate}%</p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-3xl border border-border bg-background/80 p-5">
                  <p className="label-tech">Wins</p>
                  <p className="mt-2 text-3xl font-semibold">{summary.total_wins}</p>
                </div>
                <div className="rounded-3xl border border-border bg-background/80 p-5">
                  <p className="label-tech">Losses</p>
                  <p className="mt-2 text-3xl font-semibold">{summary.total_losses}</p>
                </div>
                <div className="rounded-3xl border border-border bg-background/80 p-5">
                  <p className="label-tech">Current streak</p>
                  <p className="mt-2 text-3xl font-semibold">{summary.current_streak}</p>
                </div>
              </div>
            </Panel>

            <Panel className="grid gap-4">
              <div className="grid gap-3">
                <div className="flex items-start gap-3 rounded-3xl border border-border bg-background/80 p-5">
                  <Activity className="h-6 w-6 text-primary" />
                  <div>
                    <p className="label-tech">Favorite location</p>
                    <p className="mt-2 text-lg">{summary.favorite_location ?? "None yet"}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-3xl border border-border bg-background/80 p-5">
                  <Clock3 className="h-6 w-6 text-primary" />
                  <div>
                    <p className="label-tech">Last active</p>
                    <p className="mt-2 text-lg">
                      {summary.last_active_at
                        ? new Date(summary.last_active_at).toLocaleString()
                        : "No activity yet"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 rounded-3xl border border-border bg-background/80 p-5">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="h-6 w-6 text-primary" />
                  <p className="label-tech">Profile settings</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  Profile uses your connected wallet. All activity is loaded from the backend with no wallet management in this view.
                </p>
                <Link
                  to="/wallet"
                  className="inline-flex items-center gap-2 text-sm font-medium text-primary"
                >
                  Manage wallet
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </Panel>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
            <Panel>
              <SectionHeading eyebrow="Statistics" title="Recent performance" />
              <div className="mt-6 overflow-hidden rounded-3xl border border-border bg-background/80 p-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-3xl border border-border bg-surface-2/60 p-4">
                    <p className="label-tech">Recent bets</p>
                    <p className="mt-2 text-3xl font-semibold">{stats.length}</p>
                  </div>
                  <div className="rounded-3xl border border-border bg-surface-2/60 p-4">
                    <p className="label-tech">Positive rounds</p>
                    <p className="mt-2 text-3xl font-semibold">
                      {stats.filter((point: any) => point.profit > 0).length}
                    </p>
                  </div>
                  <div className="rounded-3xl border border-border bg-surface-2/60 p-4">
                    <p className="label-tech">Negative rounds</p>
                    <p className="mt-2 text-3xl font-semibold">
                      {stats.filter((point: any) => point.profit < 0).length}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 overflow-hidden rounded-3xl border border-border bg-background/80 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="label-tech">Profit trend</p>
                    <p className="mt-2 text-sm text-muted-foreground">Recent round profit/loss by bet.</p>
                  </div>
                  <div className="text-right text-sm text-muted-foreground">
                    {chartData.length} entries
                  </div>
                </div>

                <div className="mt-4 h-[320px] w-full">
                  <div className="h-full w-full">
                    {chartData.length === 0 ? (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                        No chart data available
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 16, right: 20, left: -10, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.35)" />
                          <XAxis
                            dataKey="name"
                            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <Tooltip
                            cursor={{ stroke: "var(--primary)", strokeDasharray: "3 3" }}
                            wrapperStyle={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--background)" }}
                          />
                          <Area
                            type="monotone"
                            dataKey="profit"
                            stroke="#22c55e"
                            fill="rgba(34, 197, 94, 0.16)"
                            strokeWidth={2}
                            dot={{ r: 3 }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              </div>
            </Panel>

            <Panel>
              <SectionHeading eyebrow="Achievements" title="Your badges" />
              <div className="mt-6 grid gap-3">
                {achievements.map((achievement: any) => (
                  <div
                    key={achievement.id}
                    className={`rounded-3xl border px-5 py-4 ${
                      achievement.unlocked ? "border-emerald-500 bg-emerald-500/10" : "border-border bg-background/80"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold">{achievement.title}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{achievement.description}</p>
                      </div>
                      <div className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]">
                        {achievement.unlocked ? "Unlocked" : "Locked"}
                      </div>
                    </div>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.min((achievement.progress / achievement.goal) * 100, 100)}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{achievement.progress}/{achievement.goal}</span>
                      <span>{achievement.unlocked ? "Complete" : "Progress"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <Panel>
            <SectionHeading eyebrow="History" title="Recent bets" />
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 font-medium text-muted-foreground">Round</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Prediction</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Result</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Stake</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        No recent bets found.
                      </td>
                    </tr>
                  ) : (
                    history.map((item: any) => (
                      <tr key={item.bet_id} className="border-b border-border/60 last:border-0">
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          #{item.round_number ?? item.round_id?.slice(-6)}
                        </td>
                        <td className="px-4 py-3">{item.prediction === 0 ? "Over" : item.prediction === 1 ? "Under" : "—"}</td>
                        <td className="px-4 py-3 uppercase text-sm text-foreground">
                          {item.status.toLowerCase()}
                        </td>
                        <td className="px-4 py-3 font-mono text-sm">{item.stake}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {new Date(item.created_at).toLocaleString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      ) : (
        <Panel>Unable to load profile summary.</Panel>
      )}
    </div>
  );
}
