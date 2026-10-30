export const WALLET_CONNECTORS = {
  METAMASK: "MetaMask",
  COINBASE: "Coinbase Wallet",
  RAINBOW: "Rainbow",
  WALLETCONNECT: "WalletConnect",
} as const;

export const SUPPORTED_WALLETS = [
  WALLET_CONNECTORS.METAMASK,
  WALLET_CONNECTORS.COINBASE,
  WALLET_CONNECTORS.RAINBOW,
  WALLET_CONNECTORS.WALLETCONNECT,
] as const;

export const WALLET_LOCAL_STORAGE_KEY = "rush.wallet.lastConnected";

export const CHAIN_KEYS = {
  ROBINHOOD: "ROBINHOOD",
} as const;

// Keep this fallback aligned with the deployed Elysium chain configuration.
// Production deployments must still provide VITE_ROBINHOOD_CHAIN_ID explicitly.
export const DEFAULT_CHAIN_ID = Number(
  import.meta.env.VITE_ROBINHOOD_CHAIN_ID ?? 46630,
);
export const DEFAULT_RPC_URL =
  import.meta.env.VITE_ROBINHOOD_RPC_URL ?? "https://rpc-live.elysp.com";
export const DEFAULT_EXPLORER_URL =
  import.meta.env.VITE_BLOCK_EXPLORER ?? "https://rpc-live.elysp.com";

export const ROBINHOOD_CHAIN_INFO = {
  chainId: DEFAULT_CHAIN_ID,
  chainName: "Elysium Chain",
  rpcUrl: DEFAULT_RPC_URL,
  explorerUrl: DEFAULT_EXPLORER_URL,
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
};

export const CHAIN_PARAMS = {
  chainId: `0x${DEFAULT_CHAIN_ID.toString(16)}`,
  chainName: ROBINHOOD_CHAIN_INFO.chainName,
  nativeCurrency: ROBINHOOD_CHAIN_INFO.nativeCurrency,
  rpcUrls: [ROBINHOOD_CHAIN_INFO.rpcUrl],
  blockExplorerUrls: [ROBINHOOD_CHAIN_INFO.explorerUrl],
};
