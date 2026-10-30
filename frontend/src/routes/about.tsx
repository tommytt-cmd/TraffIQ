import { createFileRoute, Link } from "@tanstack/react-router";

import { SectionHeading } from "@/components/panel";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About ElyRush — Live Vehicle Count Markets" },
      {
        name: "description",
        content:
          "Learn how ElyRush works, how rounds settle, and how deposits, claims, and live-market logic operate on Elysium.",
      },
      { property: "og:title", content: "About ElyRush — Live Vehicle Count Markets" },
      {
        property: "og:description",
        content:
          "A simple overview of ElyRush, the live vehicle count prediction market, and the Elysium deployment.",
      },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
      <p className="label-tech">About</p>
      <h1 className="mt-3 max-w-3xl text-4xl leading-[0.95] sm:text-5xl">
        About <span className="text-primary">Ely</span>Rush
      </h1>
      <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
        ElyRush is a live vehicle-count prediction market where players stake on whether a junction
        count lands under or over a published threshold. The market resolves using the verified count
        published by the protocol, and winners receive payouts according to the settlement rules.
      </p>

      <div className="mt-12 grid gap-6 md:grid-cols-2">
        <section className="rounded-3xl border border-border bg-surface-2/70 p-6">
          <SectionHeading eyebrow="Protocol" title="How it works" />
          <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
            <li>• A round opens with a fixed threshold and a betting deadline.</li>
            <li>• Users choose OVER or UNDER before the deadline closes.</li>
            <li>• The resolved count is compared to the threshold and the market settles.</li>
            <li>• Winning positions receive the appropriate payout per the round rules.</li>
          </ul>
        </section>

        <section className="rounded-3xl border border-border bg-surface-2/70 p-6">
          <SectionHeading eyebrow="Network" title="Elysium deployment" />
          <p className="mt-4 text-sm text-muted-foreground">
            This app is deployed on the Elysium network. Wallet switching, RPC configuration, and
            explorer links are set to the live Elysium endpoints used for the production deployment.
          </p>
        </section>
      </div>

      <section className="mt-12 rounded-3xl border border-border bg-surface-2/70 p-6">
        <SectionHeading eyebrow="Safety" title="What to verify" />
        <p className="mt-4 text-sm text-muted-foreground">
          Always confirm the active network in your wallet before submitting transactions. Rounds,
          thresholds, and settlement outcomes are public on-chain, but users should validate the live
          deployed addresses and network settings in the app before transacting.
        </p>
      </section>

      <div className="mt-10 flex flex-wrap gap-3">
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
