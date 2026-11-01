import { BrowserProvider } from "ethers";
import { WALLET_LOCAL_STORAGE_KEY, SUPPORTED_WALLETS } from "./constants";
import type { WalletAccount, WalletConnectorName } from "./types";
import {
  MetaMaskConnector,
  RabbyConnector,
  RainbowConnector,
  WalletConnectConnector,
} from "./connectors";

const CONNECTOR_MAP: Record<WalletConnectorName, typeof MetaMaskConnector> = {
  MetaMask: MetaMaskConnector,
  "Rabby Wallet": RabbyConnector,
  Rainbow: RainbowConnector,
  WalletConnect: WalletConnectConnector,
};

export class WalletService {
  static isWalletInstalled(connector: WalletConnectorName): boolean {
    const connectorInfo = CONNECTOR_MAP[connector];
    return connectorInfo?.installed() ?? false;
  }

  static getAvailableConnectors() {
    return SUPPORTED_WALLETS.filter((wallet) =>
      CONNECTOR_MAP[wallet]?.installed(),
    );
  }

  static async connect(connector: WalletConnectorName): Promise<WalletAccount> {
    const connectorInfo = CONNECTOR_MAP[connector];
    if (!connectorInfo) {
      throw new Error("Unsupported wallet connector");
    }
    if (!connectorInfo.installed()) {
      throw new Error("Wallet provider is not installed");
    }

    const provider = new BrowserProvider(window.ethereum as any);

    const accounts = await provider.send("eth_requestAccounts", []);
    if (!accounts || accounts.length === 0) {
      throw new Error("No wallet accounts found");
    }

    const address = String(accounts[0]);
    localStorage.setItem(WALLET_LOCAL_STORAGE_KEY, connector);

    return {
      address,
      providerName: connector,
    };
  }

  static async disconnect(): Promise<void> {
    localStorage.removeItem(WALLET_LOCAL_STORAGE_KEY);
  }

  static async getSigner(): Promise<ReturnType<BrowserProvider["getSigner"]>> {
    const provider = new BrowserProvider(window.ethereum as any);
    return provider.getSigner();
  }

  static getProvider(): BrowserProvider {
    return new BrowserProvider(window.ethereum as any);
  }

  static getStoredConnector(): WalletConnectorName | null {
    if (typeof window === "undefined") return null;
    const connector = localStorage.getItem(WALLET_LOCAL_STORAGE_KEY);
    return connector === "MetaMask" ||
      connector === "Rabby Wallet" ||
      connector === "Rainbow" ||
      connector === "WalletConnect"
      ? connector
      : null;
  }

  static async getAccount(): Promise<WalletAccount | null> {
    if (!window.ethereum) return null;
    const provider = new BrowserProvider(window.ethereum as any);
    const accounts = await provider.send("eth_accounts", []);
    if (!accounts || accounts.length === 0) return null;
    return { address: String(accounts[0]), providerName: "MetaMask" };
  }
}
