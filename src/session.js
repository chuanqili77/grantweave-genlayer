import { successful, terminal, validateSnapshot, canWrite } from "./model.js";

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
export const normalizeAddress = (value) => {
  if (!addressPattern.test(value || ""))
    throw Error("Enter a valid deployed contract address");
  return value.toLowerCase();
};
export const readJSON = (storage, key, fallback) => {
  try {
    const value = storage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
};

// One session binds all reads, writes and resumable IDs to one chain and contract.
export class LedgerSession {
  constructor({ adapter, storage, notify = () => {} }) {
    this.adapter = adapter;
    this.storage = storage;
    this.notify = notify;
    this.address = null;
    this.state = null;
    this.account = null;
    this.locked = false;
    this.revision = 0;
    this.stale = false;
  }
  key(address = this.address) {
    return `grantweave-pending-${this.adapter.chainId}-${address}`;
  }
  pending() {
    if (!this.address) return null;
    const raw = this.storage.getItem(this.key());
    if (raw === null) return null;
    let tx;
    try {
      tx = JSON.parse(raw);
    } catch {
      throw Error(
        "Saved transaction record is unreadable. Restore the record before writing.",
      );
    }
    if (
      !hashPattern.test(tx?.hash || "") ||
      tx.address !== this.address ||
      tx.chainId !== this.adapter.chainId
    ) {
      throw Error(
        "Saved transaction record does not match this deployment. Restore the record before writing.",
      );
    }
    return tx;
  }
  walletChanged() {
    this.account = null;
    this.revision++;
  }
  async connect() {
    const account = await this.adapter.connect();
    if (!addressPattern.test(account || ""))
      throw Error("No wallet account selected");
    this.account = account.toLowerCase();
    return this.account;
  }
  async load(value) {
    if (this.locked) throw Error("Wait for the current action to finish");
    // Invalidate old binding before validation and I/O, including malformed addresses.
    this.address = null;
    this.state = null;
    this.stale = false;
    const address = normalizeAddress(value);
    this.address = address;
    this.state = validateSnapshot(await this.adapter.read(address));
    return this.state;
  }
  unload() {
    if (this.locked) throw Error("Wait for the current action to finish");
    this.state = null;
    this.address = null;
    this.stale = false;
  }
  async exclusive(action) {
    if (this.locked) throw Error("Wait for the current action to finish");
    this.locked = true;
    try {
      return await action();
    } finally {
      this.locked = false;
    }
  }
  async write(functionName, args) {
    return this.exclusive(async () => {
      if (!this.address || !this.state)
        throw Error("Read a deployed contract before writing");
      if (this.stale) throw Error("Refresh the ledger before another write");
      if (this.pending())
        throw Error("Resume the existing transaction before another write");
      // Check storage before signing, so a disabled browser store cannot silently lose a returned ID.
      const probe = this.key() + "-probe";
      this.storage.setItem(probe, "1");
      this.storage.removeItem(probe);
      if (!this.account) await this.connect();
      const revision = this.revision;
      const accounts = await this.adapter.accounts();
      const chain = await this.adapter.chain();
      if (
        revision !== this.revision ||
        accounts[0]?.toLowerCase() !== this.account
      ) {
        this.account = null;
        throw Error("Wallet changed. Reconnect before writing.");
      }
      if (Number(chain) !== this.adapter.chainId)
        throw Error("Switch wallet to Studionet before writing");
      if (!canWrite(this.state, this.account, functionName, args))
        throw Error(
          this.state.schema === 2
            ? "This wallet cannot perform that action in the current proposal or reservation state."
            : "Only the project registrar can write. This wallet has read-only access.",
        );
      const address = this.address;
      const hash = await this.adapter.write(
        address,
        this.account,
        functionName,
        args,
      );
      if (!hashPattern.test(hash || ""))
        throw Error(
          "Submission returned no usable transaction ID. Inspect wallet activity before retrying.",
        );
      const tx = {
        hash,
        address,
        chainId: this.adapter.chainId,
        functionName,
        submittedAt: new Date().toISOString(),
      };
      try {
        this.storage.setItem(this.key(address), JSON.stringify(tx));
      } catch {
        throw Error(
          `Transaction submitted: ${hash}. Local saving failed; keep this ID and use Track transaction. Do not resubmit.`,
        );
      }
      return this.track(tx);
    });
  }
  async resume(hash) {
    return this.exclusive(async () => {
      if (!this.address)
        throw Error("Read a deployed contract before tracking a transaction");
      let tx = this.pending();
      if (hash) {
        if (!hashPattern.test(hash))
          throw Error("Enter a valid transaction ID");
        if (tx && tx.hash.toLowerCase() !== hash.toLowerCase())
          throw Error(
            "Resume the saved transaction before tracking a different ID",
          );
        // Manually supplied IDs must belong to this recipient, before they can block writes.
        const receipt = await this.adapter.transaction(hash);
        const recipient = receipt.to_address || receipt.recipient;
        if (recipient?.toLowerCase() !== this.address)
          throw Error("Transaction recipient does not match this contract");
        tx = {
          hash,
          address: this.address,
          chainId: this.adapter.chainId,
          functionName: "tracked",
        };
        this.storage.setItem(this.key(), JSON.stringify(tx));
      }
      if (!tx)
        throw Error(
          "No saved transaction. Paste an existing transaction ID to track it.",
        );
      return this.track(tx);
    });
  }
  async track(tx) {
    this.notify(
      `Tracking ${tx.hash}. If tracking times out, resume this ID; do not resubmit.`,
    );
    let receipt;
    try {
      receipt = await this.adapter.wait(tx.hash);
    } catch {
      throw Error(
        `Tracking paused for ${tx.hash}. The transaction is still saved. Resume tracking; do not resubmit.`,
      );
    }
    if (!terminal(receipt))
      throw Error(
        `Transaction remains ${receipt.statusName || "pending"}. Resume tracking; do not resubmit.`,
      );
    this.stale = true;
    if (!successful(receipt)) {
      this.storage.removeItem(this.key(tx.address));
      // Even a failed write can follow other finalized writes. Refresh before continuing.
      try {
        this.state = validateSnapshot(await this.adapter.read(tx.address));
        this.stale = false;
      } catch {
        /* Keep stale state read-only. */
      }
      throw Error(
        `Transaction ended without success: ${receipt.statusName} / ${receipt.txExecutionResultName || "unknown execution"} / ${receipt.resultName || receipt.result_name || "unknown consensus"}.`,
      );
    }
    // Keep the ID until read-back succeeds. Recovery after an RPC outage must not submit another write.
    try {
      this.state = validateSnapshot(await this.adapter.read(tx.address));
    } catch {
      throw Error(
        `Transaction ${tx.hash} finalized successfully, but the ledger could not refresh. Resume tracking to read it back; do not resubmit.`,
      );
    }
    this.stale = false;
    this.storage.removeItem(this.key(tx.address));
    this.notify(
      `Finalized successfully. Ledger refreshed. Transaction: ${tx.hash}`,
    );
    return this.state;
  }
}
