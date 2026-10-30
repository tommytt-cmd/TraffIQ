import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAccount, useConnect, type Connector } from "wagmi";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { walletStore } from "@/lib/store";

interface WalletModalContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const WalletModalContext = createContext<WalletModalContextValue>({
  open: false,
  setOpen: () => {},
});

export function useWalletModal() {
  return useContext(WalletModalContext);
}

interface WalletMeta {
  label: string;
  blurb: string;
  accent: string;
  glyph: string;
}

const META: Record<string, WalletMeta> = {
  "io.rainbow": {
    label: "Rainbow",
    blurb: "Open in Rainbow app",
    accent: "#1b2c5a",
    glyph: "R",
  },
  rainbow: {
    label: "Rainbow",
    blurb: "Open in Rainbow app",
    accent: "#1b2c5a",
    glyph: "R",
  },
  walletConnect: {
    label: "WalletConnect",
    blurb: "Rainbow, Trust, and 300+ wallets",
    accent: "#1d7cf2",
    glyph: "◉",
  },
  coinbaseWalletSDK: {
    label: "Coinbase Wallet",
    blurb: "Open in Coinbase Wallet app",
    accent: "#0052ff",
    glyph: "◍",
  },
  "io.metamask": {
    label: "MetaMask",
    blurb: "Open in MetaMask app",
    accent: "#3a1e0d",
    glyph: "M",
  },
  metaMask: {
    label: "MetaMask",
    blurb: "Open in MetaMask app",
    accent: "#3a1e0d",
    glyph: "M",
  },
};

function normalizeWalletKey(value?: string) {
  return value?.trim().toLowerCase().replace(/\s+/g, "") ?? "";
}

function metaFor(connector: Connector) {
  const lookupKeys = [connector.id, connector.name].map(normalizeWalletKey);

  const directMatch =
    META[connector.id] ??
    META[connector.name] ??
    Object.entries(META).find(([key]) => normalizeWalletKey(key) === lookupKeys[0])?.[1] ??
    Object.entries(META).find(([key]) => normalizeWalletKey(key) === lookupKeys[1])?.[1];

  return directMatch ?? {
    label: connector.name,
    blurb: "Connect with " + connector.name,
    accent: "#1f2a26",
    glyph: "◆",
  };
}

function WalletLogo({ meta }: { meta: WalletMeta }) {
  return (
    <span
      className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg font-display text-lg font-bold text-white"
      style={{ backgroundColor: meta.accent }}
      aria-hidden
    >
      <span className="leading-none">{meta.glyph}</span>
    </span>
  );
}

function WalletModal() {
  const { open, setOpen } = useWalletModal();
  const { connectors, connectAsync, isPending, variables } = useConnect();

  const list = useMemo(() => {
    const seen = new Set<string>();
    return connectors.filter((c) => {
      const key = metaFor(c).label;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [connectors]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-background/80 p-4 backdrop-blur-sm sm:items-center">
      <button
        aria-label="Close wallet dialog"
        className="absolute inset-0 cursor-default"
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Connect wallet"
        className="clip-tech relative w-full max-w-md border border-primary/40 bg-surface shadow-[0_0_60px_-12px_hsl(var(--primary)/0.4)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h2 className="font-display text-xl font-bold uppercase tracking-[0.16em]">
              Connect wallet
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose your wallet to get started
            </p>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-3 px-6 py-5">
          {list.map((connector) => {
            const meta = metaFor(connector);
            const busy = isPending && variables?.connector === connector;
            return (
              <button
                key={connector.uid}
                disabled={isPending}
                onClick={async () => {
                  try {
                    await connectAsync({ connector });
                    setOpen(false);
                  } catch (error) {
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Wallet connection cancelled",
                    );
                  }
                }}
                className="clip-tag flex items-center gap-4 border border-border bg-surface-2/60 px-4 py-3 text-left transition-colors hover:border-primary disabled:opacity-60"
              >
                <WalletLogo meta={meta} />
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-base font-bold tracking-[0.08em]">
                    {meta.label}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {meta.blurb}
                  </span>
                </span>
                {busy && (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                )}
              </button>
            );
          })}
        </div>

        <div className="border-t border-border px-6 py-4 text-center text-sm text-muted-foreground">
          By connecting you agree to the{" "}
          <span className="text-foreground">terms of service</span>
        </div>
      </div>
    </div>
  );
}

function WalletSync() {
  const { address, connector, isConnected } = useAccount();

  useEffect(() => {
    if (isConnected && address) {
      walletStore.connect(connector?.name ?? "Wallet");
    } else {
      walletStore.disconnect();
    }
  }, [address, connector, isConnected]);

  return null;
}

export function WalletModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open, setOpen }), [open]);

  return (
    <WalletModalContext.Provider value={value}>
      <WalletSync />
      {children}
      <WalletModal />
    </WalletModalContext.Provider>
  );
}

// Backwards-compatible alias for callers that used the old name.
export const WalletProviders = WalletModalProvider;
