import { createFileRoute } from "@tanstack/react-router";
import React from "react";

// hero image removed for production copy
import { Panel, SectionHeading } from "@/components/panel";
import { AlertTriangle } from "lucide-react";
import { DEFAULT_EXPLORER_URL } from "@/services/blockchain/constants";
import { shortAddress } from "@/lib/round";

const deployedAddresses = [
  { label: "TraffIQ token", address: import.meta.env.VITE_RUSH_TOKEN_ADDRESS as string | undefined },
  { label: "Prediction market", address: import.meta.env.VITE_BETTING_CONTRACT_ADDRESS as string | undefined },
  { label: "Protocol treasury", address: import.meta.env.VITE_RUSH_TREASURY_ADDRESS as string | undefined },
  { label: "Stock treasury", address: import.meta.env.VITE_STOCK_TREASURY_ADDRESS as string | undefined },
  { label: "Reward vault", address: import.meta.env.VITE_STOCK_VAULT as string | undefined },
].filter((deployment): deployment is { label: string; address: string } => Boolean(deployment.address));

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About TRAFFIQ — Vehicle Count Prediction Markets" },
      {
        name: "description",
        content:
          "TRAFFIC is an on-chain under/over vehicle-count prediction market where winning positions receive pro-rata allocations of the round's purchased stock tokens.",
      },
      { property: "og:title", content: "About TRAFFIC — Vehicle Count Prediction Markets" },
      {
        property: "og:description",
        content: "How vehicle-count rounds, stock-token rewards and protocol buybacks work on-chain.",
      },
    ],
  }),
  component: About,
});

function About() {
  // track active section for the left nav
  const sections = [
    'overview',
    'how-it-works',
    'utility',
    'participate',
    'data-and-settlement',
    'security',
    'roadmap',
    'contribute',
  ];

  const titles: Record<string, string> = {
    overview: 'Overview',
    'how-it-works': 'How it works',
    utility: 'Tokenomics',
    participate: 'How to participate',
    'data-and-settlement': 'Data & settlement',
    security: 'Security & audits',
    roadmap: 'Roadmap',
    contribute: 'Contribute & contact',
  };

  const [active, setActive] = React.useState('overview');

  React.useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActive(entry.target.id);
        });
      },
      { root: null, rootMargin: '-40% 0px -40% 0px', threshold: 0 }
    );

    sections.forEach((id) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });

    return () => obs.disconnect();
  }, []);

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <div className="mb-8">
        <p className="label-tech">About</p>
        <h1 className="mt-3 max-w-3xl text-4xl leading-[0.95] sm:text-5xl">TraffIQ</h1>
        <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
          TraffIQ is an on-chain under/over vehicle-count prediction market. Each market has a
          published threshold, a betting deadline, and a final count submitted by the designated
          result publisher. Eligible winning positions share the stock tokens bought for that market
          in proportion to their winning stake.
        </p>
      </div>

      <div className="md:flex md:gap-8">
        <aside className="mb-6 md:w-1/4">
          <nav className="sticky top-20 space-y-2">
            {/*[
              ['overview', 'Overview'],
              ['how-it-works', 'How it works'],
              ['utility', 'Tokenomics'],
              ['participate', 'Participate'],
              ['data-and-settlement', 'Data & settlement'],
              ['security', 'Security'],
              ['roadmap', 'Roadmap'],
              ['contribute', 'Contribute'],
            ]*/}{
              [
              ['overview', 'Overview'],
              ['how-it-works', 'How it works'],
              ['utility', 'Tokenomics'],
              ['participate', 'Participate'],
              ['data-and-settlement', 'Data & settlement'],
              ].map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                className={`block label-tech transition-colors px-2 py-1 rounded ${
                  active === id ? 'text-primary font-medium bg-surface/40 border-l-2 border-primary' : 'text-muted-foreground'
                }`}
              >
                {label}
              </a>
            ))}
          </nav>
        </aside>

        <main className="prose max-w-none md:w-3/4">
          <div className="sticky top-16 z-10 mb-4">
            <div className="inline-block rounded-md bg-surface-2/80 px-3 py-1 text-sm font-medium text-foreground shadow-sm backdrop-blur-sm">
              {titles[active]}
            </div>
          </div>
          <section id="overview">
            <SectionHeading eyebrow="Docs" title="Overview" />
            <p>
              Each market opens with a threshold and a closing time. Players stake ETH on
              <strong> OVER</strong> or <strong>UNDER</strong>. Once betting has closed, the designated
              result publisher submits the final vehicle count. The protocol records the outcome and
              routes the winner reward pool into the stock-reward flow.
            </p>
          </section>

          <Panel className="mb-6">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-warning mt-0.5" />
              <div>
                <p className="label-tech">Important</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Only the designated result publisher can submit the count used to settle a market.
                  The protocol records the threshold, stakes, count and settlement, but it does not
                  independently verify a camera feed or store footage on-chain.
                </p>
              </div>
            </div>
          </Panel>

          <section id="how-it-works">
            <SectionHeading eyebrow="Design" title="How it works" />
            <ol className="list-decimal pl-6">
              <li>
                The protocol operator publishes a threshold and betting deadline; players place OVER
                or UNDER ETH stakes before that deadline.
              </li>
              <li>
                Once betting has closed, the designated result publisher submits the final vehicle count. OVER
                wins only when the count is greater than the threshold; a count equal to the
                threshold resolves as UNDER.
              </li>
              <li>
                After protocol fees and any market-balancing allocation, eligible winners are
                recorded with their winning stakes as their share of the reward pool.
              </li>
              <li>
                The protocol treasury buys every enabled stock with an equal share of the market's
                ETH, sends the acquired tokens to the reward vault, and then opens claims.
              </li>
            </ol>
          </section>

          <section id="utility">
            <SectionHeading eyebrow="Token" title="Tokenomics" />
            <p>
              TraffIQ is the protocol token used by the treasury's buyback mechanism. In this version,
              TraffIQ bought with settlement-fee funds is burned. No settlement-fee TraffIQ is directed
              to staking in the current release; a staking allocation is planned for a future
              version. This is not a promise of yield or governance rights.
            </p>
            {deployedAddresses.length > 0 && (
              <div className="mt-5 rounded-md border border-border bg-surface-2/40 p-4">
                <p className="label-tech">Verify deployed addresses</p>
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {deployedAddresses.map(({ label, address }) => (
                    <li key={label} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span>{label}:</span>
                      <a
                        href={`${DEFAULT_EXPLORER_URL}/address/${address}`}
                        target="_blank"
                        rel="noreferrer"
                        title={address}
                        className="font-mono text-primary underline-offset-4 hover:underline"
                      >
                        {shortAddress(address)}
                      </a>
                      <span className="text-xs">Robinhood Blockscout ↗</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section id="participate">
            <SectionHeading eyebrow="Participation" title="How to participate" />
            <ul>
              <li>Connect an EVM wallet and choose OVER or UNDER before the round closes.</li>
              <li>Confirm the ETH bet transaction from your wallet.</li>
              <li>
                If your side wins and the stock purchases finalize, claim each eligible stock token
                from the reward vault. Your allocation is proportional to your stake on the winning
                side.
              </li>
            </ul>
          </section>

          <section id="data-and-settlement">
            <SectionHeading eyebrow="Data" title="Data & settlement" />
            <p>
              The designated result publisher is the on-chain authority for the final count. Anyone
              can inspect the market data, stakes, settlement, purchased-token records, and reward
              calculations on the block explorer. Evidence for the off-chain count—such as a video
              archive or AI processing record—must be supplied by the application and its operators;
              it is not embedded on-chain.
            </p>
          </section>

          {/*<section id="security">
            <SectionHeading eyebrow="Safety" title="Security & audits" />
            <p>
              Key actions are restricted to defined protocol roles: the operator configures markets
              and treasury addresses, the designated result publisher submits outcomes, and reward
              funds can move only through the configured protocol flow. Users should verify deployed
              addresses and settings on the block explorer and should not treat this site as an
              audit, guarantee of availability, or investment advice.
            </p>
          </section>

          <section id="roadmap">
            <SectionHeading eyebrow="Plan" title="Roadmap" />
            <p>
              The deployed design supports configurable market thresholds and durations, a
              configurable protocol-fee split, an optional mechanism for an empty betting side, and
              an operator-managed list of enabled stock tokens. Future features should be judged by
              deployed updates and published configuration, not by this page alone.
            </p>
          </section>

          <section id="contribute">
            <SectionHeading eyebrow="Community" title="Contribute & contact" />
            <p>
              Contributions are welcome — open issues, audits, UI improvements, and integrations.
              For partnership or operator onboarding, contact the team via the project repository or
              the community channels linked in the footer.
            </p>
          </section>*/}
        </main>
      </div>
    </div>
  );
}
