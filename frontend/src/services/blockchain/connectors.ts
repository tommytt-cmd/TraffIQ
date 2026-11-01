import type { WalletConnectorName } from "./types";

export interface WalletConnector {
  id: WalletConnectorName;
  label: string;
  installed: () => boolean;
}

export const MetaMaskConnector: WalletConnector = {
  id: "MetaMask",
  label: "MetaMask",
  installed: () =>
    typeof window !== "undefined" && typeof window.ethereum !== "undefined",
};

export const RabbyConnector: WalletConnector = {
  id: "Rabby Wallet",
  label: "Rabby Wallet",
  installed: () =>
    typeof window !== "undefined" &&
    Boolean(
      window.ethereum?.isRabby ||
      window.ethereum?.providers?.some((provider) => provider.isRabby),
    ),
};

export const WalletConnectConnector: WalletConnector = {
  id: "WalletConnect",
  label: "WalletConnect",
  installed: () => false,
};

export const RainbowConnector: WalletConnector = {
  id: "Rainbow",
  label: "Rainbow",
  installed: () =>
    typeof window !== "undefined" &&
    Boolean(
      window.ethereum?.isRainbow ||
      window.ethereum?.providers?.some((provider) => provider.isRainbow),
    ),
};

export const CONNECTORS = [
  MetaMaskConnector,
  RabbyConnector,
  RainbowConnector,
  WalletConnectConnector,
];
