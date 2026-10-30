import { createFileRoute, Link } from "@tanstack/react-router";

import { useWallet } from "@/hooks/useWallet";

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

  const connectWallet = async () => {
    try {
      await wallet.connect("MetaMask");
    } catch (error) {
      console.error("Wallet connect failed", error);
    }
  };

  const disconnectWallet = async () => {
    try {
      await wallet.disconnect();
    } catch (error) {
      console.error("Wallet disconnect failed", error);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
      <p className="label-tech">Wallet</p>
      <h1 className="mt-3 max-w-2xl text-4xl leading-[0.95] sm:text-5xl">
        Manage your <span className="text-primary">Ely</span>Rush wallet
      </h1>

      <div className="mt-10 rounded-3xl border border-border bg-surface-2/70 p-6">
        {wallet.connected && wallet.address ? (
          <div className="space-y-5">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Connected wallet</p>
              <p className="mt-2 font-mono text-lg text-foreground">{wallet.address}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-border bg-background p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Status</p>
                <p className="mt-2 text-sm text-foreground">{wallet.status}</p>
              </div>
              <div className="rounded-2xl border border-border bg-background p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Balance</p>
                <p className="mt-2 text-sm text-foreground">{wallet.balance.toFixed(4)} ETH</p>
              </div>
              <div className="rounded-2xl border border-border bg-background p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Network</p>
                <p className="mt-2 text-sm text-foreground">
                  {wallet.isCorrectNetwork ? "Elysium" : "Wrong network"}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              {!wallet.isCorrectNetwork ? (
                <button
                  type="button"
                  onClick={() => void wallet.switchNetwork()}
                  className="rounded-full bg-primary px-5 py-3 text-sm font-bold uppercase tracking-[0.16em] text-primary-foreground"
                >
                  Switch network
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => void disconnectWallet()}
                className="rounded-full border border-border bg-background px-5 py-3 text-sm font-bold uppercase tracking-[0.16em] text-foreground"
              >
                Disconnect
              </button>
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
              className="rounded-full bg-primary px-5 py-3 text-sm font-bold uppercase tracking-[0.16em] text-primary-foreground"
            >
              Connect wallet
            </button>
          </div>
        )}
      </div>

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
