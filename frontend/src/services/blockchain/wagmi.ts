import { createConfig, http } from "wagmi";
import {
  coinbaseWallet,
  injected,
  metaMask,
  walletConnect,
} from "@wagmi/connectors";
import { defineChain } from "viem";

const elysiumRpcUrl =
  import.meta.env["VITE_ROBINHOOD_RPC_URL"] ?? "https://rpc-live.elysp.com";
const elysiumExplorerUrl =
  import.meta.env["VITE_BLOCK_EXPLORER"] ?? "https://rpc-live.elysp.com";
const elysiumChainId = Number(
  import.meta.env["VITE_ROBINHOOD_CHAIN_ID"] ?? 46630,
);

export const robinhoodChain = defineChain({
  id: elysiumChainId,
  name: "Elysium Chain",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [elysiumRpcUrl],
    },
  },
  blockExplorers: {
    default: {
      name: "Elysium Explorer",
      url: elysiumExplorerUrl,
    },
  },
  testnet: false,
});

const walletConnectProjectId =
  import.meta.env["VITE_WALLETCONNECT_PROJECT_ID"] ?? "";

type WagmiRuntime = {
  connectors: {
    MetaMask: ReturnType<typeof metaMask>;
    Coinbase: ReturnType<typeof coinbaseWallet>;
    Rainbow: ReturnType<typeof injected>;
    WalletConnect: ReturnType<typeof walletConnect>;
  };
  config: ReturnType<typeof createConfig>;
};

const runtimeKey = "__traffic_wagmi_runtime__";
const globalRuntime = globalThis as typeof globalThis & {
  [runtimeKey]?: WagmiRuntime;
};

// Vite HMR re-evaluates this module during development. Reusing the runtime
// prevents WalletConnect Core from being initialized once per hot reload.
const runtime =
globalRuntime[runtimeKey] ??
  (() => {
    const connectors = {
      MetaMask: metaMask(),
      Coinbase: coinbaseWallet({ appName: "ElyRush" }),
      Rainbow: injected({
        shimDisconnect: true,
        target: {
          id: "rainbow",
          name: "Rainbow",
          provider: (window) => {
            const providers = window?.ethereum?.providers;
            return (
              providers?.find((provider) => provider.isRainbow) ??
              (window?.ethereum?.isRainbow ? window.ethereum : undefined)
            );
          },
        },
      }),
      WalletConnect: walletConnect({
        projectId: walletConnectProjectId,
        showQrModal: false,
      }),
    };

    const value: WagmiRuntime = {
      connectors,
      config: createConfig({
        chains: [robinhoodChain],
        connectors: [
          connectors.MetaMask,
          connectors.Coinbase,
          connectors.Rainbow,
          connectors.WalletConnect,
        ],
        multiInjectedProviderDiscovery: false,
        transports: {
          [robinhoodChain.id]: http(elysiumRpcUrl),
        },
      }),
    };

    globalRuntime[runtimeKey] = value;
    return value;
  })();

export const wagmiConnectors = runtime.connectors;
export const wagmiConfig = runtime.config;
