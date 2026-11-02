import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import {
  metaMaskWallet,
  rabbyWallet,
  rainbowWallet,
  injectedWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { http, defineChain } from "viem";

const elysiumRpcUrl =
  import.meta.env["VITE_ELYSIUM_RPC_URL"] ??
  "https://testnet-rpc.elysium.kinetiq.xyz";
const elysiumExplorerUrl =
  import.meta.env["VITE_BLOCK_EXPLORER"] ??
  "https://elysium.kinetiq.xyz/testnet-explorer";

export const elysiumTestnetChain = defineChain({
  id: Number(import.meta.env["VITE_ELYSIUM_CHAIN_ID"] ?? 99801),
  name: "Kinetiq Elysium Testnet",
  nativeCurrency: {
    name: "HYPE",
    symbol: "HYPE",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [elysiumRpcUrl],
    },
  },
  blockExplorers: {
    default: {
      name: "Elysium Testnet Explorer",
      url: elysiumExplorerUrl,
    },
  },
  testnet: true,
});

// RainbowKit throws while creating the app config if the ID is empty. Its
// documented placeholder keeps the rest of the site renderable until a
// production-specific WalletConnect project ID is configured.
const walletConnectProjectId =
  import.meta.env["VITE_WALLETCONNECT_PROJECT_ID"] || "YOUR_PROJECT_ID";

export const wagmiConfig = getDefaultConfig({
  appName: "ElyRush",
  projectId: walletConnectProjectId,
  chains: [elysiumTestnetChain],
  wallets: [
    {
      groupName: "Popular",
      wallets: [
        metaMaskWallet,
        rabbyWallet,
        injectedWallet,
        rainbowWallet,
        walletConnectWallet,
      ],
    },
  ],
  transports: {
    [elysiumTestnetChain.id]: http(elysiumRpcUrl),
  },
  ssr: true,
});
