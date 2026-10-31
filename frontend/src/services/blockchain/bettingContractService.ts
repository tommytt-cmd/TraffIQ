import type { Abi, Address, PublicClient, WalletClient } from "viem";
import type { ClaimStatus } from "./types";
import { ContractFactory } from "./contractFactory";
import { ROBINHOOD_CHAIN_INFO } from "./constants";
import { formatTokenAmount } from "./utils";
// Keep the frontend ABI coupled to the Foundry artifact that is deployed.  The
// previous aliases pointed at files that were never checked into `src`, which
// made every production build fail before a wallet could connect.
import RushBettingArtifact from "./RushBetting.json";
import RushHolderVaultArtifact from "./RushHolderVault.json";

const MIN_BET_ABI = [{
  type: "function",
  name: "getMinBet",
  stateMutability: "view",
  inputs: [],
  outputs: [{ type: "uint256" }],
}] as const satisfies Abi;

function getBettingContractConfig() {
  const address = import.meta.env["VITE_BETTING_CONTRACT_ADDRESS"] as string | undefined;
  const artifact = RushBettingArtifact as Record<string, any>;
  const abi: Abi | undefined = artifact["abi"] ?? artifact["default"]?.["abi"];

  if (!address) {
    throw new Error("Missing VITE_BETTING_CONTRACT_ADDRESS environment variable.");
  }
  if (!abi || !Array.isArray(abi)) {
    throw new Error(
      "Unable to resolve contract ABI from RushBetting.json. Ensure the imported file exports an object with an `abi` array."
    );
  }

  return { address, abi };
}

export class BettingContractService {
  static async getMinBet(provider: PublicClient): Promise<bigint> {
    const { address } = getBettingContractConfig();
    const minBet = await provider.readContract({
      address: address as Address,
      abi: MIN_BET_ABI,
      functionName: "getMinBet",
    });
    return BigInt(minBet.toString());
  }

  static async getRushRewardHistory(provider: PublicClient, player: Address, limit = 25) {
    const { address, abi } = getBettingContractConfig();
    const latest = BigInt(await provider.readContract({ address: address as Address, abi, functionName: "latestRound" }) as bigint);
    const holderVaultAddress = await provider.readContract({
      address: address as Address,
      abi,
      functionName: "rushHolderVault",
    }) as Address;
    const holderAbi = (RushHolderVaultArtifact as Record<string, unknown>)["abi"] as Abi;
    const first = latest > BigInt(limit) ? latest - BigInt(limit) + 1n : 1n;
    const rounds = Array.from({ length: Number(latest >= first ? latest - first + 1n : 0n) }, (_, index) => latest - BigInt(index));
    
    const entries = await Promise.all(rounds.map(async (roundNumber) => {
      const [claimable, hasClaimed, isStaked, buyback, holderClaimed] = await Promise.all([
        // Prefer per-round claimable rush reward if available; fall back to global pending RUSH.
        provider.readContract({ address: address as Address, abi, functionName: "getClaimableRushReward", args: [roundNumber, player] }).catch(() =>
          provider.readContract({ address: address as Address, abi, functionName: "getPendingRUSH", args: [player] })
        ),
        provider.readContract({ address: address as Address, abi, functionName: "hasClaimedRush", args: [roundNumber, player] }),
        provider.readContract({ address: address as Address, abi, functionName: "isRushRewardStaked", args: [roundNumber, player] }),
        provider.readContract({ address: address as Address, abi, functionName: "getRoundRushBuyback", args: [roundNumber] }),
        holderVaultAddress && holderVaultAddress !== "0x0000000000000000000000000000000000000000"
          ? provider.readContract({ address: holderVaultAddress, abi: holderAbi, functionName: "hasClaimedRushRewardStake", args: [roundNumber, player] }).catch(() => false)
          : Promise.resolve(false),
      ]);

      const safeClaimable = BigInt(claimable?.toString() ?? "0");
      const safeBuyback = BigInt(buyback?.toString() ?? "0");

      // FIXED: If the automated keeper has finalized it, it is automatically staked and ready!
      return { 
        roundNumber, 
        gross: safeClaimable, 
        claimed: Boolean(hasClaimed), 
        staked: Boolean(isStaked) || Boolean(hasClaimed) || Boolean(holderClaimed),
        buyback: safeBuyback 
      };
    }));
    
    return entries.filter((entry) => entry.gross > 0n || entry.claimed || entry.staked);
  }

  /**
   * Return stock reward history per round by querying the configured StockVault
   * for per-token entitlements. Each entry contains tokens with entitled/claimable amounts.
   */
  static async getStockRewardHistory(provider: PublicClient, player: Address, limit = 25) {
    const { address, abi } = getBettingContractConfig();
    const currentRound = BigInt(
      (await provider.readContract({ address: address as Address, abi, functionName: "currentRoundId" })) as bigint,
    );
    const first = currentRound > BigInt(limit) ? currentRound - BigInt(limit) + 1n : 1n;
    const rounds = Array.from(
      { length: Number(currentRound >= first ? currentRound - first + 1n : 0n) },
      (_, index) => currentRound - BigInt(index),
    );

    const vaultAddress = (import.meta.env["VITE_STOCK_VAULT_ADDRESS"] ?? import.meta.env["VITE_STOCK_VAULT"]) as string | undefined;
    if (!vaultAddress) return [] as Array<any>;

    const STOCK_VAULT_ABI: Abi = [
      { type: "function", name: "calculateEntitlement", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }] },
      { type: "function", name: "isWinner", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "address" }], outputs: [{ type: "bool" }] },
      { type: "function", name: "getWinnerContribution", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "address" }], outputs: [{ type: "uint256" }] },
      { type: "function", name: "getRoundInfo", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bool" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }] },
    ];

    const entries = await Promise.all(rounds.map(async (roundNumber) => {
      try {
        const [winner, contribution, vaultRound, gameRound] = await Promise.all([
          provider.readContract({ address: vaultAddress as Address, abi: STOCK_VAULT_ABI, functionName: "isWinner", args: [roundNumber, player] }),
          provider.readContract({ address: vaultAddress as Address, abi: STOCK_VAULT_ABI, functionName: "getWinnerContribution", args: [roundNumber, player] }),
          provider.readContract({ address: vaultAddress as Address, abi: STOCK_VAULT_ABI, functionName: "getRoundInfo", args: [roundNumber] }),
          provider.readContract({ address: address as Address, abi, functionName: "getRoundInfo", args: [roundNumber] }),
        ]);
        if (!winner) return null;
        const tokens = await BettingContractService.getRoundBoughtTokens(provider, Number(roundNumber));

        let totalEntitled = 0n;
        let totalClaimable = 0n;
        const tokenEntries: Array<any> = [];
        for (const t of tokens) {
          const [entitled, alreadyClaimed, claimable] = await provider.readContract({ address: vaultAddress as Address, abi: STOCK_VAULT_ABI, functionName: "calculateEntitlement", args: [roundNumber, t as Address, player] }).catch(() => [0n, 0n, 0n]);
          const entitlement = BigInt(entitled?.toString() ?? "0");
          totalEntitled += entitlement;
          totalClaimable += BigInt(claimable?.toString() ?? "0");
          tokenEntries.push({ token: t, entitled: entitlement, alreadyClaimed: BigInt(alreadyClaimed?.toString() ?? "0"), claimable: BigInt(claimable?.toString() ?? "0") });
        }

        const anyClaimed = tokenEntries.some((te) => te.alreadyClaimed > 0n);
        const [created, finalized] = vaultRound as [boolean, boolean, bigint, bigint];
        const round = gameRound as any;
        return {
          roundNumber,
          contribution: BigInt(contribution.toString()),
          gross: totalClaimable,
          entitled: totalEntitled,
          claimed: anyClaimed,
          created: Boolean(created),
          finalized: Boolean(finalized),
          settled: Boolean(round.settled ?? round[12]),
          winningSide: Number(round.winningSide ?? round[11]) === 0 ? "OVER" : "UNDER",
          tokens: tokenEntries,
        };
      } catch (err) {
        return null;
      }
    }));

    return (entries.filter(Boolean) as Array<any>).filter((entry) => entry.gross > 0n || entry.claimed);
  }

  static async getBetHistory(provider: PublicClient, player: Address, limit = 25) {
    const { address, abi } = getBettingContractConfig();
    const latest = BigInt(await provider.readContract({ address: address as Address, abi, functionName: "currentRoundId" }) as bigint);
    const first = latest > BigInt(limit) ? latest - BigInt(limit) + 1n : 1n;
    const rounds = Array.from({ length: Number(latest >= first ? latest - first + 1n : 0n) }, (_, index) => latest - BigInt(index));
    const entries = await Promise.all(rounds.map(async (roundNumber) => {
      try {
        const userBet = await BettingContractService.getUserBet(provider, Number(roundNumber), player);
        const amount = BigInt(userBet.amount ?? 0n);
        if (amount > 0n) {
          return { roundNumber, side: userBet.side, amount };
        }
        return null;
      } catch (error) {
        return null;
      }
    }));

    return entries.filter(Boolean) as Array<{ roundNumber: bigint; side: string; amount: bigint }>;
  }

  static async getHolderPosition(provider: PublicClient, player: Address) {
    const { address: bettingAddress, abi: bettingAbi } = getBettingContractConfig();
    const holderVaultAddress = await provider.readContract({
      address: bettingAddress as Address,
      abi: bettingAbi,
      functionName: "rushHolderVault",
    }) as Address;
    if (!holderVaultAddress || holderVaultAddress === "0x0000000000000000000000000000000000000000") {
      return {
        holderVaultAddress: undefined, shares: 0n, pendingRewards: 0n, grossAmount: 0n, feeAmount: 0n, netAmount: 0n,
        custody: 0n, stakingAssets: 0n, liabilities: 0n, solvent: false,
      };
    }
    const artifact = RushHolderVaultArtifact as Record<string, any>;
    const abi = artifact["abi"] as Abi;
    const [shares, pendingRewards, preview, custody, stakingAssets, liabilities, solvent] = await Promise.all([
      provider.readContract({ address: holderVaultAddress, abi, functionName: "playerShares", args: [player] }),
      provider.readContract({ address: holderVaultAddress, abi, functionName: "pendingHolderReward", args: [player] }),
      provider.readContract({ address: holderVaultAddress, abi, functionName: "previewWithdrawAll", args: [player] }),
      provider.readContract({ address: holderVaultAddress, abi, functionName: "actualRushBalance" }),
      provider.readContract({ address: holderVaultAddress, abi, functionName: "stakingAssets" }),
      provider.readContract({ address: holderVaultAddress, abi, functionName: "totalRushLiabilities" }),
      provider.readContract({ address: holderVaultAddress, abi, functionName: "isSolvent" }),
    ]);
    const [grossAmount, feeAmount, netAmount] = preview as [bigint, bigint, bigint];
    return {
      holderVaultAddress,
      shares: BigInt(shares.toString()),
      pendingRewards: BigInt(pendingRewards.toString()),
      grossAmount: BigInt(grossAmount.toString()),
      feeAmount: BigInt(feeAmount.toString()),
      netAmount: BigInt(netAmount.toString()),
      custody: BigInt(custody.toString()),
      stakingAssets: BigInt(stakingAssets.toString()),
      liabilities: BigInt(liabilities.toString()),
      solvent: Boolean(solvent),
    };
  }

  static async claimHolderRewards(signer: WalletClient, holderVaultAddress: Address) {
    const artifact = RushHolderVaultArtifact as Record<string, any>;
    return signer.writeContract({
      address: holderVaultAddress,
      abi: artifact["abi"] as Abi,
      functionName: "claimHolderRewards",
      account: signer.account!,
    });
  }

  static async withdrawAllRush(signer: WalletClient, holderVaultAddress: Address) {
    const artifact = RushHolderVaultArtifact as Record<string, any>;
    return signer.writeContract({
      address: holderVaultAddress,
      abi: artifact["abi"] as Abi,
      functionName: "withdrawAll",
      account: signer.account!,
    });
  }

  static async previewRushWithdraw(provider: PublicClient, holderVaultAddress: Address, shares: bigint) {
    const artifact = RushHolderVaultArtifact as Record<string, any>;
    return provider.readContract({ address: holderVaultAddress, abi: artifact["abi"] as Abi, functionName: "previewWithdraw", args: [shares] }) as Promise<[bigint, bigint, bigint]>;
  }

  static async withdrawRush(signer: WalletClient, holderVaultAddress: Address, shares: bigint) {
    const artifact = RushHolderVaultArtifact as Record<string, any>;
    return signer.writeContract({ address: holderVaultAddress, abi: artifact["abi"] as Abi, functionName: "withdraw", args: [shares], account: signer.account! });
  }

  static async getRushWalletBalance(provider: PublicClient, player: Address) {
    const { address: bettingAddress, abi } = getBettingContractConfig();
    const rushToken = await provider.readContract({ address: bettingAddress as Address, abi, functionName: "rushToken" }) as Address;
    if (!rushToken || rushToken === "0x0000000000000000000000000000000000000000") return 0n;
    return provider.readContract({ address: rushToken, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] }] as Abi, functionName: "balanceOf", args: [player] }) as Promise<bigint>;
  }

  static getContract(provider: PublicClient) {
    const { address, abi } = getBettingContractConfig();
    return ContractFactory.createReadContract(address, abi, provider);
  }

  static getSignerContract(signer: WalletClient) {
    const { address, abi } = getBettingContractConfig();
    return ContractFactory.createWriteContract(address, abi, signer);
  }

  static async getUserBet(provider: PublicClient, roundNumber: number, player: string) {
    const { address, abi } = getBettingContractConfig();

    // Read the autogenerated `userBets(uint256,address,uint8)` getter for
    // both sides: OVER = 0, UNDER = 1 (matches on-chain enum).
    {/*console.debug("[BettingContractService] getUserBet readContract send", {
      address,
      functionName: "userBets",
      roundNumber,
      player,
    });*/}

    const [rawOver, rawUnder] = await Promise.all([
      provider.readContract({ address: address as Address, abi, functionName: "userBets", args: [BigInt(roundNumber), player as Address, 0n] }).catch(() => 0n),
      provider.readContract({ address: address as Address, abi, functionName: "userBets", args: [BigInt(roundNumber), player as Address, 1n] }).catch(() => 0n),
    ]);

    const normalizedOverAmount = rawOver === undefined || rawOver === null ? 0n : BigInt(rawOver.toString());
    const normalizedUnderAmount = rawUnder === undefined || rawUnder === null ? 0n : BigInt(rawUnder.toString());

    {/*console.debug("[BettingContractService] getUserBet normalized result", {
      normalizedOverAmount,
      normalizedUnderAmount,
    });*/}

    if (normalizedOverAmount > 0n && normalizedOverAmount >= normalizedUnderAmount) {
      return { side: "OVER", amount: normalizedOverAmount };
    }
    if (normalizedUnderAmount > 0n) {
      return { side: "UNDER", amount: normalizedUnderAmount };
    }
    return { side: "OVER", amount: 0n };
  }

  static async getClaimableReward(provider: PublicClient, address: string) {
    const { address: contractAddress, abi } = getBettingContractConfig();
    {/*console.debug("[BettingContractService] getClaimableReward send", {
      address: contractAddress,
      functionName: "getClaimableReward",
      args: [address],
    });*/}

    // The current on-chain name is `getPendingRUSH` in some deployments.
    const result = await provider.readContract({
      address: contractAddress as Address,
      abi,
      functionName: "getClaimableReward",
      args: [address as Address],
    }).catch(async () => {
      return provider.readContract({ address: contractAddress as Address, abi, functionName: "getPendingRUSH", args: [address as Address] }).catch(() => 0n);
    });

    {/*console.debug("[BettingContractService] getClaimableReward result", result);*/}
    return result === undefined || result === null ? 0n : BigInt(result.toString());
  }

  static async getClaimableEth(provider: PublicClient, address: string) {
    const { address: contractAddress, abi } = getBettingContractConfig();
    {/*console.debug("[BettingContractService] getClaimableEth send", {
      address: contractAddress,
      functionName: "getClaimableEth",
      args: [address],
    });*/}

    // Some deployments expose this as `getPendingETH`.
    const result = await provider.readContract({
      address: contractAddress as Address,
      abi,
      functionName: "getClaimableEth",
      args: [address as Address],
    }).catch(async () => {
      return provider.readContract({ address: contractAddress as Address, abi, functionName: "getPendingETH", args: [address as Address] }).catch(() => 0n);
    });

    {/*console.debug("[BettingContractService] getClaimableEth result", result);*/}
    return result === undefined || result === null ? 0n : BigInt(result.toString());
  }

  /*static async getClaimStatus(provider: PublicClient, address: string): Promise<ClaimStatus> {
    const { address: contractAddress, abi } = getBettingContractConfig();
    console.debug("[BettingContractService] getClaimStatus send", {
      address: contractAddress,
      functionName: "getClaimStatus",
      args: [address],
    });

    const result = await provider.readContract({
      address: contractAddress as Address,
      abi,
      functionName: "getClaimStatus",
      args: [address as Address],
    });

    console.debug("[BettingContractService] getClaimStatus result", result);

    if (result === undefined || result === null) return "unknown";

    const status = String(result);
    if (status === "already_claimed") return "already_claimed";
    if (status === "available") return "available";
    if (status === "none") return "none";
    return "unknown";
  }*/

  static async estimateClaimEth(provider: PublicClient, account: Address, roundNumber: number) {
    const { address: contractAddress, abi } = getBettingContractConfig();
    return provider.estimateContractGas({
      address: contractAddress as Address,
      abi,
      functionName: "claimETH",
      account,
      args: [BigInt(roundNumber)],
    });
  }

  static async claimEth(signer: WalletClient, roundNumber: number) {
    const { address: contractAddress, abi } = getBettingContractConfig();
    const account = signer.account;

    if (typeof signer.writeContract !== "function") {
      throw new Error("Wallet signer is not a viem WalletClient: missing writeContract().");
    }

    if (!account) {
      throw new Error("Wallet client has no connected account.");
    }

    return signer.writeContract({
      chain: signer.chain,
      address: contractAddress as Address,
      abi,
      functionName: "claimETH",
      account,
      args: [BigInt(roundNumber)],
    });
  }

  /**
   * RUSH rewards are claimed through the holder vault, where they are minted
   * as staking shares. RushBetting deliberately has no `claimReward` or
   * `claimMultiple` entry point, so never send a transaction to either of
   * those non-existent methods.
   */
  static async claimRushRewardStake(provider: PublicClient, signer: WalletClient, roundNumber: number) {
    const { address: bettingAddress, abi: bettingAbi } = getBettingContractConfig();
    const account = signer.account;
    if (!account) throw new Error("Wallet client has no connected account.");

    const holderVaultAddress = await provider.readContract({
      address: bettingAddress as Address,
      abi: bettingAbi,
      functionName: "rushHolderVault",
    }) as Address;
    if (!holderVaultAddress || holderVaultAddress === "0x0000000000000000000000000000000000000000") {
      throw new Error("The RUSH holder vault is not configured for this betting contract.");
    }

    const holderAbi = (RushHolderVaultArtifact as Record<string, unknown>)["abi"] as Abi;
    return signer.writeContract({
      chain: signer.chain,
      address: holderVaultAddress,
      abi: holderAbi,
      functionName: "claimRushRewardStake",
      args: [BigInt(roundNumber)],
      account,
    });
  }

  static async getProtocolFee(provider: PublicClient) {
    const { address: contractAddress, abi } = getBettingContractConfig();
    {/*console.debug("[BettingContractService] getProtocolFee send", {
      address: contractAddress,
      functionName: "protocolFeeBps",
    });*/}

    const result = await provider.readContract({
      address: contractAddress as Address,
      abi,
      functionName: "protocolFeeBps",
      args: [],
    });

    {/*console.debug("[BettingContractService] getProtocolFee result", result);*/}
    return result === undefined || result === null ? 0n : BigInt(result.toString());
  }

  static async getRoundBoughtTokens(provider: PublicClient, roundNumber: number) {
    const { address: contractAddress, abi } = getBettingContractConfig();
    const result = await provider.readContract({
      address: contractAddress as Address,
      abi,
      functionName: "roundBoughtTokens",
      args: [BigInt(roundNumber), 0n],
    }).catch(() => undefined);
    // `roundBoughtTokens` is a public Solidity array getter, so it exposes an
    // index rather than a whole array. Read a small bounded set of slots and
    // stop at the first unset address.
    if (!result) return [] as Address[];
    const tokens: Address[] = [];
    for (let index = 0; index < 16; index += 1) {
      const token = await provider.readContract({
        address: contractAddress as Address,
        abi,
        functionName: "roundBoughtTokens",
        args: [BigInt(roundNumber), BigInt(index)],
      }).catch(() => "0x0000000000000000000000000000000000000000" as Address);
      if (token.toLowerCase() === "0x0000000000000000000000000000000000000000") break;
      tokens.push(token as Address);
    }
    return tokens;
  }

  static async getUserUnclaimedTokenForRound(provider: PublicClient, roundNumber: number, player: Address, token: Address) {
    const { address: contractAddress, abi } = getBettingContractConfig();
    const result = await provider.readContract({
      address: contractAddress as Address,
      abi,
      functionName: "getUserUnclaimedTokenForRound",
      args: [BigInt(roundNumber), player as Address, token as Address],
    }).catch(() => 0n);
    return result === undefined || result === null ? 0n : BigInt(result.toString());
  }

  static async claimStock(signer: WalletClient, roundNumber: number, token: Address) {
    const { address: contractAddress, abi } = getBettingContractConfig();
    const account = signer.account;

    if (typeof signer.writeContract !== "function") {
      throw new Error("Wallet signer is not a viem WalletClient: missing writeContract().");
    }
    if (!account) throw new Error("Wallet client has no connected account.");

    return signer.writeContract({
      chain: signer.chain,
      address: contractAddress as Address,
      abi,
      functionName: "claimStock",
      args: [BigInt(roundNumber), token as Address],
      account,
    });
  }

  /**
   * Some deployments route token claims through a dedicated StockVault.
   * This helper writes directly to the configured `VITE_STOCK_VAULT_ADDRESS`.
   */
  static async claimStockOnVault(signer: WalletClient, roundNumber: number, token: Address) {
    const account = signer.account;
    if (typeof signer.writeContract !== "function") {
      throw new Error("Wallet signer is not a viem WalletClient: missing writeContract().");
    }
    if (!account) throw new Error("Wallet client has no connected account.");

    const vaultAddress = (import.meta.env["VITE_STOCK_VAULT_ADDRESS"] ?? import.meta.env["VITE_STOCK_VAULT"]) as string | undefined;
    if (!vaultAddress) throw new Error("Missing VITE_STOCK_VAULT (or VITE_STOCK_VAULT_ADDRESS) environment variable.");

    const abi: Abi = [
      { type: "function", name: "claimStock", stateMutability: "nonpayable", inputs: [{ name: "roundId", type: "uint256" }, { name: "stockToken", type: "address" }], outputs: [] },
    ];

    return signer.writeContract({
      chain: signer.chain,
      address: vaultAddress as Address,
      abi,
      functionName: "claimStock",
      args: [BigInt(roundNumber), token as Address],
      account,
    });
  }

  static async getRoundPool(provider: PublicClient, roundNumber: number) {
    const { address: contractAddress, abi } = getBettingContractConfig();
    const result = await provider.readContract({
      address: contractAddress as Address,
      abi,
      functionName: "getRoundPool",
      args: [BigInt(roundNumber)],
    });
    const [overPool, underPool] = (Array.isArray(result) ? result : [0n, 0n]) as [bigint, bigint];
    return {
      over: Number(formatTokenAmount(BigInt(overPool.toString()))),
      under: Number(formatTokenAmount(BigInt(underPool.toString()))),
    };
  }

  static async estimatePlaceBet(provider: PublicClient, account: Address, roundNumber: number, side: string, amountWei: bigint) {
    const { address: contractAddress, abi } = getBettingContractConfig();

    // IRushBetting.Side enum on-chain: OVER = 0, UNDER = 1.
    // Map our string side to the on-chain numeric value.
    const normalizedSide = side.toUpperCase() === "OVER" ? 0n : 1n;
    return provider.estimateContractGas({
      address: contractAddress as Address,
      abi,
      functionName: "bet",
      account,
      args: [BigInt(roundNumber), normalizedSide],
      value: amountWei,
    });
  }

  static async placeBet(signer: WalletClient, roundNumber: number, side: string, amountWei: bigint) {
    const { address: contractAddress, abi } = getBettingContractConfig();
    const account = signer.account;

    if (typeof signer.writeContract !== "function") {
      console.error("[BettingContractService] placeBet() signer lacks writeContract", {
        signer,
        signerType: typeof signer,
        hasAccount: Boolean(account),
      });
      throw new Error("Wallet signer is not a viem WalletClient: missing writeContract().");
    }

    {/*console.debug("[BettingContractService] placeBet() signer account + contract payload", {
      account,
      address: contractAddress,
      roundNumber,
      side,
      normalizedSide: side.toUpperCase() === "OVER" ? 1n : 0n,
      amountWei,
      abiLength: abi.length,
      chain: signer.chain,
    });*/}

    if (!account) {
      throw new Error("Wallet client has no connected account.");
    }

    // On-chain enum: OVER = 0, UNDER = 1. Ensure we encode accordingly.
    const normalizedSide = side.toUpperCase() === "OVER" ? 0n : 1n;

    try {
      const txHash = await signer.writeContract({
        chain: signer.chain,
        address: contractAddress as Address,
        abi,
        functionName: "bet",
        account,
        args: [BigInt(roundNumber), normalizedSide],
        value: amountWei,
      });

      {/*console.debug("[BettingContractService] placeBet() writeContract resolved", {
        txHash,
      });*/}

      return txHash;
    } catch (error) {
      {/*console.error("[BettingContractService] placeBet() writeContract failure", {
        error,
        message: (error as Error)?.message,
        contractAddress,
        functionName: "bet",
        roundNumber,
        side,
        normalizedSide,
        amountWei,
      });*/}
      throw error;
    }
  }

  static getExplorerTxUrl(txHash: string) {
    return `${ROBINHOOD_CHAIN_INFO.explorerUrl}/tx/${txHash}`;
  }
}
