import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { normalizeReceipt } from "./model.js";

export function createAdapter(provider = window.ethereum) {
  const reader = createClient({ chain: studionet });
  return {
    chainId: studionet.id,
    async connect() {
      if (!provider) throw Error("Open in a browser with an Ethereum wallet");
      const [account] = await provider.request({
        method: "eth_requestAccounts",
      });
      return account;
    },
    accounts: () => provider.request({ method: "eth_accounts" }),
    chain: () => provider.request({ method: "eth_chainId" }),
    read: (address) =>
      reader.readContract({
        address,
        functionName: "snapshot",
        args: [],
        transactionHashVariant: "latest-final",
      }),
    transaction: (hash) => reader.getTransaction({ hash }),
    wait: async (hash) =>
      normalizeReceipt(await reader.waitForTransactionReceipt({
        hash,
        status: "FINALIZED",
        interval: 5000,
        retries: 24,
        fullTransaction: true,
      })),
    async write(address, account, functionName, args) {
      const writer = createClient({ chain: studionet, account, provider });
      await writer.connect("studionet");
      // Wallet state can change while MetaMask's GenLayer connection is being approved.
      const [current] = await provider.request({ method: "eth_accounts" });
      const chain = await provider.request({ method: "eth_chainId" });
      if (current?.toLowerCase() !== account || Number(chain) !== studionet.id)
        throw Error("Wallet or network changed. Reconnect before writing.");
      return writer.writeContract({
        address,
        account,
        functionName,
        args,
        value: 0n,
      });
    },
  };
}
