import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { formatTokenAmount, parseTokenAmount } from "@/services/blockchain/utils";
import { BettingContractService } from "@/services/blockchain/bettingContractService";
import { useWallet } from "@/hooks/useWallet";
import { useRoundState } from "@/hooks/use-round-state";
import type { ClaimStatus } from "@/services/blockchain/types";

export type BetSide = "OVER" | "UNDER";

interface UserBetState {
  minBetWei: bigint | null;
  minBetLoading: boolean;
  pool: { under: number; over: number } | null;
  poolLoading: boolean;
  hasBet: boolean;
  side: BetSide | null;
  amountWei: bigint | null;
  amountEth: string;
  claimableEth: string;
  claimableRush: string;
  claimStatus: ClaimStatus;
  protocolFeeBps?: number;
  loading: boolean;
  error: string | null;
}

const initialState: UserBetState = {
  minBetWei: null,
  minBetLoading: true,
  pool: null,
  poolLoading: true,
  hasBet: false,
  side: null,
  amountWei: null,
  amountEth: "0",
  claimableEth: "0",
  claimableRush: "0",
  claimStatus: "unknown",
  protocolFeeBps: undefined,
  loading: false,
  error: null,
};

const MAX_REASONABLE_PLACE_BET_GAS = 1_000_000n;

export function useBettingContract(roundNumberOverride?: number) {
  const wallet = useWallet();
  const [state, setState] = useState<UserBetState>(initialState);

  const provider = wallet.provider;
  const round = useRoundState();
  const contractRoundNumber = roundNumberOverride ?? round.roundNumber;

  useEffect(() => {
    // A new round must not inherit the previous round's locked position.
    setState((current) => ({
      ...initialState,
      minBetWei: current.minBetWei,
      minBetLoading: current.minBetLoading,
    }));
  }, [contractRoundNumber]);

  useEffect(() => {
    let cancelled = false;
    if (!provider) {
      setState((current) => ({ ...current, minBetWei: null, minBetLoading: false }));
      return;
    }

    setState((current) => ({ ...current, minBetLoading: true }));
    void BettingContractService.getMinBet(provider)
      .then((minBetWei) => {
        if (!cancelled) setState((current) => ({ ...current, minBetWei, minBetLoading: false }));
      })
      .catch((error) => {
        console.error("[useBettingContract] getMinBet failure", error);
        if (!cancelled) setState((current) => ({ ...current, minBetWei: null, minBetLoading: false }));
      });

    return () => { cancelled = true; };
  }, [provider]);

  const readPool = useCallback(async () => {
    if (!provider) return;
    setState((current) => ({ ...current, pool: null, poolLoading: true }));
    try {
      const pool = await BettingContractService.getRoundPool(provider, contractRoundNumber);
      setState((current) => ({ ...current, pool, poolLoading: false }));
    } catch (error) {
      console.error("[useBettingContract] getRoundPool failure", error);
      setState((current) => ({ ...current, pool: null, poolLoading: false, error: (error as Error).message }));
    }
  }, [provider, contractRoundNumber]);

  const readUserBet = useCallback(async () => {
    if (!provider || !wallet.address) return;
    console.debug("[useBettingContract] readUserBet start", {
      connected: wallet.connected,
      address: wallet.address,
      roundNumber: contractRoundNumber,
      providerReady: Boolean(provider),
    });
    setState((current) => ({ ...current, loading: true, error: null }));

    try {
      const userBet = await BettingContractService.getUserBet(provider, contractRoundNumber, wallet.address);
      console.debug("[useBettingContract] getUserBet result", userBet);

      const claimable = await BettingContractService.getClaimableReward(provider, wallet.address);
      console.debug("[useBettingContract] getClaimableReward result", claimable);

      const claimableEth = await BettingContractService.getClaimableEth(provider, wallet.address);
      console.debug("[useBettingContract] getClaimableEth result", claimableEth);

      const claimStatusRaw = claimableEth > 0n || claimable > 0n ? "available" : "none";
      console.debug("[useBettingContract] getClaimStatus result", claimStatusRaw);

      const fee = await BettingContractService.getProtocolFee(provider);
      console.debug("[useBettingContract] getProtocolFee result", fee);

      const amountWei = userBet?.amount !== undefined && userBet?.amount !== null ? BigInt(userBet.amount.toString()) : null;
      const hasBet = Boolean(amountWei && amountWei > 0n);
      const side = hasBet
        ? String(userBet?.side ?? "OVER").toUpperCase() === "OVER"
          ? "OVER"
          : "UNDER"
        : null;

      const safeClaimableEth = claimableEth === undefined || claimableEth === null ? 0n : BigInt(claimableEth.toString());
      const safeClaimableRush = claimable === undefined || claimable === null ? 0n : BigInt(claimable.toString());
      const safeFee = fee === undefined || fee === null ? 0n : BigInt(fee.toString());

      console.debug("[useBettingContract] formatted normalization inputs", {
        amountWei,
        side,
        hasBet,
        safeClaimableEth,
        safeClaimableRush,
        safeFee,
      });

      setState((current) => ({
        ...current,
        hasBet,
        side,
        amountWei,
        amountEth: amountWei ? formatTokenAmount(amountWei) : "0",
        claimableEth: formatTokenAmount(safeClaimableEth),
        claimableRush: formatTokenAmount(safeClaimableRush),
        claimStatus: String(claimStatusRaw) as string,
        protocolFeeBps: Number(safeFee),
        loading: false,
        error: null,
      }));
    } catch (error) {
      console.error("[useBettingContract] readUserBet pipeline failure", error);
      setState((current) => ({ ...current, loading: false, error: (error as Error).message }));
    }
  }, [provider, wallet.address, contractRoundNumber]);

  useEffect(() => {
    void readPool();
  }, [readPool]);

  useEffect(() => {
    if (!wallet.connected || !provider || !wallet.address) return;
    void readUserBet();
  }, [wallet.connected, provider, wallet.address, contractRoundNumber, readUserBet]);

  const placeBet = useCallback(
    async (side: BetSide, amountEth: string) => {
      if (state.minBetWei === null) {
        throw new Error("Unable to read the on-chain minimum bet. Please try again shortly.");
      }
      const amountWei = parseTokenAmount(amountEth);
      if (amountWei < state.minBetWei) {
        throw new Error(`Bet amount must be at least ${formatTokenAmount(state.minBetWei)} HYPE.`);
      }
      if (!wallet.signer) {
        throw new Error("No wallet signer available");
      }
      if (!provider || !wallet.address) {
        throw new Error("Wallet provider is not ready for gas estimation.");
      }

      const estimatedGas = await BettingContractService.estimatePlaceBet(
        provider,
        wallet.address,
        contractRoundNumber,
        side,
        amountWei,
      );

      console.debug("[useBettingContract] placeBet gas estimate", {
        contractRoundNumber,
        side,
        amountWei,
        estimatedGas,
      });

      if (estimatedGas > MAX_REASONABLE_PLACE_BET_GAS) {
        throw new Error(
          `Aborted: the network estimated ${estimatedGas.toString()} gas for this bet. No wallet transaction was submitted.`,
        );
      }

      return BettingContractService.placeBet(wallet.signer, contractRoundNumber, side, amountWei);
    },
    [provider, wallet.address, wallet.signer, contractRoundNumber, state.minBetWei],
  );

  const claimEth = useCallback(async (roundNumber: number) => {
    if (!wallet.signer) {
      throw new Error("No wallet signer available");
    }
    return BettingContractService.claimEth(wallet.signer, roundNumber);
  }, [wallet.signer]);

  const claimStock = useCallback(async (roundNumber: number, token: string) => {
    if (!wallet.signer) throw new Error("No wallet signer available");
    return BettingContractService.claimStock(wallet.signer, roundNumber, token as Address);
  }, [wallet.signer]);

  const claimRushRewardStake = useCallback(async (roundNumber: number) => {
    if (!wallet.signer || !provider) {
      throw new Error("Wallet signer and network provider are required to claim RUSH.");
    }
    return BettingContractService.claimRushRewardStake(provider, wallet.signer, roundNumber);
  }, [provider, wallet.signer]);

  const readClaimState = useCallback(async () => {
    if (!provider || !wallet.address) return;
    console.debug("[useBettingContract] readClaimState start", {
      address: wallet.address,
      providerReady: Boolean(provider),
    });
    setState((current) => ({ ...current, loading: true, error: null }));

    try {
      const claimable = await BettingContractService.getClaimableReward(provider, wallet.address);
      console.debug("[useBettingContract] readClaimState reward result", claimable);

      const claimableEth = await BettingContractService.getClaimableEth(provider, wallet.address);
      console.debug("[useBettingContract] readClaimState eth result", claimableEth);

      const claimStatusRaw = await BettingContractService.getClaimStatus(provider, wallet.address);
      console.debug("[useBettingContract] readClaimState claimStatus result", claimStatusRaw);

      const safeClaimableEth = claimableEth === undefined || claimableEth === null ? 0n : BigInt(claimableEth.toString());
      const safeClaimableRush = claimable === undefined || claimable === null ? 0n : BigInt(claimable.toString());

      console.debug("[useBettingContract] readClaimState normalization", {
        safeClaimableEth,
        safeClaimableRush,
      });

      setState((current) => ({
        ...current,
        claimableEth: formatTokenAmount(safeClaimableEth),
        claimableRush: formatTokenAmount(safeClaimableRush),
        claimStatus: String(claimStatusRaw) as string,
        loading: false,
        error: null,
      }));
    } catch (error) {
      console.error("[useBettingContract] readClaimState pipeline failure", error);
      setState((current) => ({ ...current, loading: false, error: (error as Error).message }));
    }
  }, [provider, wallet.address]);

  return useMemo(
    () => ({
      ...state,
      readPool,
      readUserBet,
      readClaimState,
      placeBet,
      claimEth,
      claimStock,
      claimRushRewardStake,
    }),
    [state, readPool, readUserBet, readClaimState, placeBet, claimEth, claimStock, claimRushRewardStake],
  );
}
