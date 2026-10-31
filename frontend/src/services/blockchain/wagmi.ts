import { getDefaultConfig } from "@rainbow-me/rainbowkit";
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

const walletConnectProjectId =
  import.meta.env["VITE_WALLETCONNECT_PROJECT_ID"] ?? "";

export const wagmiConfig = getDefaultConfig({
  appName: "ElyRush",
  projectId: walletConnectProjectId,
  chains: [elysiumTestnetChain],
  transports: {
    [elysiumTestnetChain.id]: http(elysiumRpcUrl),
  },
  ssr: true,
});
