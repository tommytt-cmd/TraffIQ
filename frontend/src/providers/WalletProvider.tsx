import { useEffect, useMemo } from "react";
import {
  useAccount,
  useBalance,
  useConnect,
  useDisconnect,
  usePublicClient,
  useSwitchChain,
  useWalletClient,
} from "wagmi";
import { WalletContext } from "./WalletContext";
import type {
  WalletConnectorName,
  WalletContextValue,
  WalletState,
} from "@/services/blockchain/types";
import { elysiumTestnetChain } from "@/services/blockchain/wagmi";

function normalizeChainId(value: number | string | bigint | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    const parsed = Number.parseInt(trimmed, 16);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

const initialState: WalletState = {
  connected: false,
  address: null,
  providerName: null,
  chainId: null,
  chainName: null,
  status: "idle",
  balance: 0,
  nativeBalance: "0",
  tokenBalances: {},
  isCorrectNetwork: false,
  lastConnectedWallet: null,
  error: null,
};

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const {
    connectAsync,
    connectors,
    error: connectError,
  } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const {
    address,
    connector,
    isConnected,
    status: accountStatus,
    chainId: accountChainId,
  } = useAccount();
  const publicClient = usePublicClient({ chainId: elysiumTestnetChain.id });
  const { data: walletClient } = useWalletClient({
    chainId: elysiumTestnetChain.id,
  });
  // disable continuous balance polling to avoid excessive RPC calls; refetch on demand
  const { data: balanceData, refetch: refetchBalance } = useBalance({
    address,
    chainId: elysiumTestnetChain.id,
    watch: false,
    enabled: Boolean(address),
    // periodic background refresh kept low to reduce RPC usage
    refetchInterval: 60_000,
  });

  const provider = publicClient ?? null;
  const signer = walletClient ?? null;

  const connect = async (connectorName: WalletConnectorName) => {
    const selectedConnector = connectors.find((candidate) => {
      const name = candidate.name.toLowerCase();
      const id = candidate.id.toLowerCase();
      switch (connectorName) {
        case "MetaMask":
          return name.includes("metamask") || id.includes("metamask");
        case "Rabby Wallet":
          return name.includes("rabby") || id.includes("rabby");
        case "Coinbase Wallet":
          return name.includes("coinbase") || id.includes("coinbase");
        case "Rainbow":
          return name.includes("rainbow") || id.includes("rainbow");
        case "WalletConnect":
          return name.includes("walletconnect") || id.includes("walletconnect");
      }
    });
    if (!selectedConnector) {
      throw new Error(`Unsupported wallet connector: ${connectorName}`);
    }
    await connectAsync({ connector: selectedConnector });
  };

  const disconnect = async () => {
    if (!connector || typeof connector.disconnect !== "function") {
      return;
    }

    try {
      await disconnectAsync();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/disconnect is not a function/i.test(message)) {
        return;
      }
      throw error;
    }
  };

  const switchNetwork = async () => {
    const normalizedAccountChainId = normalizeChainId(accountChainId);
    if (normalizedAccountChainId === elysiumTestnetChain.id) return;
    await switchChainAsync({ chainId: elysiumTestnetChain.id });
  };

  const refreshBalances = async () => {
    if (refetchBalance) {
      await refetchBalance();
    }
  };

  const contextValue = useMemo<WalletContextValue>(() => {
    const chainId = normalizeChainId(accountChainId);
    const providerName = connector?.name ? String(connector.name) : null;
    const normalizedProviderName =
      providerName === "MetaMask" ||
      providerName === "Rabby Wallet" ||
      providerName === "Coinbase Wallet" ||
      providerName === "Rainbow" ||
      providerName === "WalletConnect"
        ? (providerName as WalletConnectorName)
        : null;
    // RainbowKit restores the Wagmi connector asynchronously on reload. During
    // that window Wagmi reports `reconnecting`, while useConnect() remains idle.
    // Use the account state (and the same address/chain signal as the header)
    // so the wallet page never treats a restored session as disconnected.
    const accountReady = Boolean(address && chainId);

    return {
      ...initialState,
      connected: accountReady || isConnected,
      address: address ?? null,
      providerName: normalizedProviderName,
      chainId,
      chainName: elysiumTestnetChain.name,
      status: accountReady || isConnected
        ? "connected"
        : accountStatus === "connecting" || accountStatus === "reconnecting"
          ? "connecting"
          : "idle",
      balance: Number(balanceData?.formatted ?? "0"),
      nativeBalance: balanceData?.formatted ?? "0",
      tokenBalances: {},
      isCorrectNetwork: chainId === elysiumTestnetChain.id,
      lastConnectedWallet: normalizedProviderName,
      error: connectError?.message ?? null,
      provider,
      signer,
      connect,
      disconnect,
      switchNetwork,
      refreshBalances,
    };
  }, [
    isConnected,
    accountStatus,
    address,
    connector,
    accountChainId,
    connectors,
    connectError,
    balanceData,
    provider,
    signer,
    connect,
    disconnect,
    switchNetwork,
    refreshBalances,
  ]);

  return (
    <WalletContext.Provider value={contextValue}>
      {children}
    </WalletContext.Provider>
  );
}
