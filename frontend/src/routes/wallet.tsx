  async function switchNetwork() {
    const expected = Number(import.meta.env.VITE_ROBINHOOD_CHAIN_ID ?? 4663);
    const chainIdHex = `0x${expected.toString(16)}`;
    try {
      if (!(window as any).ethereum) throw new Error("No injected wallet");
      await (window as any).ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
      toast.success("Switched network in wallet.");
      return true;
    } catch (err: any) {
      // 4902 = chain not added to wallet
      if (err?.code === 4902) {
        // attempt to add chain (best-effort)
        try {
          await (window as any).ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: chainIdHex,
              chainName: "Elysium Mainnet",
              nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
              rpcUrls: [import.meta.env.VITE_ROBINHOOD_RPC ?? "https://rpc-live.elysp.com"],
            }],
          });
          toast.success("Added and switched to the supported network.");
          return true;
        } catch (addErr: any) {
          toast.error(addErr?.message || "Unable to add network to wallet.");
          return false;
        }
      }
      toast.error(err?.message || "Unable to switch network.");
      return false;
    }
  }
