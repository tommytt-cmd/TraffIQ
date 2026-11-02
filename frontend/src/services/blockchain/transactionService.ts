import type { TransactionReceipt } from "ethers";
import type { JsonRpcSigner } from "ethers";

export class TransactionService {
  static async sendTransaction(
    signer: JsonRpcSigner,
    transaction: Parameters<JsonRpcSigner["sendTransaction"]>[0],
  ): Promise<TransactionReceipt> {
    try {
      const tx = await signer.sendTransaction(transaction);
      return await tx.wait();
    } catch (error) {
      const normalized = TransactionService.normalizeError(error);
      throw new Error(normalized);
    }
  }

  static normalizeError(error: unknown, context: "wallet" | "transaction" = "transaction"): string {
    const raw = error as any;
    const message = raw?.message ?? raw?.details ?? raw?.shortMessage ?? String(error);
    const statusText = String(message).toLowerCase();

    if (statusText.includes("user rejected") || statusText.includes("rejected")) {
      return "Request cancelled. No transaction was sent.";
    }
    if (statusText.includes("insufficient funds")) {
      return "Your HYPE balance may not cover the amount and network fee.";
    }
    if (statusText.includes("replacement fee too low")) {
      return "The network fee is too low. Please try again.";
    }
    if (statusText.includes("execution reverted") || statusText.includes("reverted")) {
      return "The transaction could not be completed. Check the requirements and try again.";
    }
    if (statusText.includes("chain")) {
      return "There was a network issue. Check that your wallet is connected to Elysium and try again.";
    }

    return context === "wallet"
      ? "We couldn't connect to your wallet. Unlock it and try again."
      : "We couldn't complete the transaction. Please try again.";
  }
}
