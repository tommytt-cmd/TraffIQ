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
      const revertReason = TransactionService.getRevertReason(raw, String(message));
      return revertReason
        ? `The transaction reverted: ${revertReason}`
        : "The transaction could not be completed because the contract rejected it. Check the requirements and try again.";
    }
    if (statusText.includes("chain")) {
      return "There was a network issue. Check that your wallet is connected to Elysium and try again.";
    }

    return context === "wallet"
      ? "We couldn't connect to your wallet. Unlock it and try again."
      : "We couldn't complete the transaction. Please try again.";
  }

  private static getRevertReason(raw: any, message: string): string | null {
    const candidates = [
      raw?.reason,
      raw?.revert?.name,
      raw?.error?.reason,
      raw?.error?.message,
      raw?.info?.error?.message,
      raw?.cause?.reason,
      raw?.cause?.shortMessage,
      raw?.cause?.message,
      message,
    ];

    for (const candidate of candidates) {
      if (typeof candidate !== "string") continue;
      const text = candidate.trim();
      if (!text) continue;

      const matched = text.match(
        /(?:execution reverted|reverted)(?:\s+with reason string)?\s*:?\s*["']?(.+?)["']?(?:\s+\(action=|\s+\(code=|$)/i,
      );
      const reason = matched?.[1]?.trim();
      if (reason && !/^(?:\[?object object\]?|unknown|no reason|$)/i.test(reason)) {
        return reason.slice(0, 240);
      }

      // Ethers exposes decoded revert text directly as `reason` on some errors.
      if (candidate === raw?.reason && !/^(?:execution reverted|call exception|unknown)$/i.test(text)) {
        return text.slice(0, 240);
      }
    }

    return null;
  }
}
