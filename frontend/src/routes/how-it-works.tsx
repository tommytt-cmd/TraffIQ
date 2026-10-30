import { createFileRoute, Link } from "@tanstack/react-router";

import { Panel, SectionHeading } from "@/components/panel";
import { PHASE_COPY, PHASE_DURATIONS, PHASE_ORDER } from "@/lib/round";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "How ElyRush Works — Phases, Thresholds, Settlement" },
      {
        name: "description",
        content:
          "How a ElyRush vehicle-count round accepts ETH stakes, resolves through its oracle, and allocates purchased stock tokens to winning users.",
      },
      { property: "og:title", content: "How ElyRush Works — Phases, Thresholds, Settlement" },
      {
        property: "og:description",
        content: "The betting deadline, oracle settlement, stock purchase and claim flow for a ElyRush round.",
      },
    ],
  }),
  component: HowItWorks,
});

const STEPS = [
  {
    title: "A round opens",
    body: "The protocol operator opens a prediction market with a vehicle threshold and betting deadline. The threshold is fixed for that market after it opens.",
  },
  {
    title: "You pick a side",
    body: "You stake ETH on either UNDER or OVER before the on-chain deadline. A configured minimum stake may apply.",
  },
  {
    title: "The market settles",
    body: "After betting closes, only the designated result publisher can submit the final count. OVER wins when the count is greater than the threshold; an equal count resolves as UNDER.",
  },
  {
    title: "Winners claim stock tokens",
    body: "The post-fee winner reward pool is used to buy the enabled stock-token portfolio. Once the reward vault is finalized, each winning user can claim a pro-rata allocation for each purchased token.",
  },
];

function HowItWorks() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
      <p className="label-tech">Protocol</p>
      <h1 className="mt-3 max-w-2xl text-4xl leading-[0.95] sm:text-5xl">How <span className="text-primary">Ely</span>Rush works</h1>
      <p className="mt-4 max-w-xl text-sm text-muted-foreground">
        Every prediction market asks whether the final vehicle count will finish UNDER or OVER its
        published threshold. The interface shows four operational phases; the protocol enforces the
        betting deadline and settlement by the designated result publisher.
      </p>

      <div className="mt-12 grid gap-4 md:grid-cols-4">
        {PHASE_ORDER.map((p, i) => (
          <Panel key={p}>
            <p className="font-mono text-xs text-primary">0{i + 1}</p>
            <h2 className="mt-3 text-xl">{PHASE_COPY[p].label}</h2>
            <p className="label-tech mt-1">{PHASE_DURATIONS[p]}s</p>
            <p className="mt-3 text-sm text-muted-foreground">{PHASE_COPY[p].blurb}</p>
          </Panel>
        ))}
      </div>

      <div className="mt-16">
        <SectionHeading eyebrow="Round lifecycle" title="From feed to payout">
          Thresholds and betting deadlines are stored on-chain before players enter positions. The
          application may show live telemetry, but the designated result publisher's post-deadline
          result is the value that settles the market.
        </SectionHeading>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {STEPS.map((s, i) => (
            <div key={s.title} className="border-l-2 border-primary/50 pl-5">
              <p className="font-mono text-xs text-primary">STEP {i + 1}</p>
              <h3 className="mt-2 text-xl">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-16">
        <SectionHeading eyebrow="Rewards" title="How winning allocations are calculated" />
        <Panel className="mt-6">
          <p className="font-mono text-sm text-primary">
            token allocation = round token balance × your winning stake ÷ total winning-user stake
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            The protocol records eligible winners and their winning stakes in the reward vault. The
            protocol treasury divides the market's available ETH equally across every enabled stock,
            swaps into those tokens, and transfers them to the vault. Each winner's claim is
            calculated separately for each acquired token. If a stock purchase fails, the protocol
            operator can retry it before the reward vault is finalized.
          </p>
        </Panel>
      </div>

      <div className="mt-16 flex flex-wrap gap-3">
        <Link
          to="/"
          className="clip-tag bg-primary px-5 py-3 font-display text-xs font-bold uppercase tracking-[0.16em] text-primary-foreground"
        >
          Go to live round
        </Link>
        <Link
          to="/wallet"
          className="clip-tag border border-primary/60 px-5 py-3 font-display text-xs font-bold uppercase tracking-[0.16em] text-primary"
        >
          Set up wallet
        </Link>
      </div>
    </div>
  );
}
