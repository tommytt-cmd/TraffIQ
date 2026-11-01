import type { PublicClient, WalletClient } from "viem";

export type ConnectionStatus =
  "idle" | "connecting" | "connected" | "disconnected" | "error";

export type WalletConnectorName =
  "MetaMask" | "Rabby Wallet" | "Coinbase Wallet" | "Rainbow" | "WalletConnect";

export interface WalletAccount {
  address: string;
  providerName: WalletConnectorName;
}

export interface ChainInfo {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

export interface TokenBalance {
  tokenAddress: string;
  symbol: string;
  decimals: number;
  balance: bigint;
  formatted: string;
}

export interface TransactionResult {
  transactionHash: string;
  blockNumber: number;
  status: number;
  receipt: TransactionReceipt;
}

export type ClaimStatus = "unknown" | "available" | "already_claimed" | "none";

export interface TransactionItem {
  id: string;
  title: string;
  description: string;
  status: string;
  explorerUrl: string;
}

export interface WalletState {
  connected: boolean;
  address: string | null;
  providerName: WalletConnectorName | null;
  chainId: number | null;
  chainName: string | null;
  status: ConnectionStatus;
  balance: number;
  nativeBalance: string;
  tokenBalances: Record<string, TokenBalance>;
  isCorrectNetwork: boolean;
  lastConnectedWallet: WalletConnectorName | null;
  error: string | null;
}

export interface WalletContextValue extends WalletState {
  provider: PublicClient | null;
  signer: WalletClient | null;
  connect: (connector: WalletConnectorName) => Promise<void>;
  disconnect: () => Promise<void>;
  switchNetwork: () => Promise<void>;
  refreshBalances: () => Promise<void>;
}
