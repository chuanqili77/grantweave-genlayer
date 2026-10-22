import { test } from "node:test";
import assert from "node:assert/strict";
import { LedgerSession, readJSON } from "./session.js";
import { demo, validateSnapshot } from "./model.js";
const address = "0x" + "a".repeat(40),
  other = "0x" + "b".repeat(40),
  owner = "0x" + "1".repeat(40),
  hash = "0x" + "f".repeat(64);
const finalized = {
  statusName: "FINALIZED",
  txExecutionResultName: "FINISHED_WITH_RETURN", resultName: "MAJORITY_AGREE",
};
function fixture() {
  const values = new Map();
  const storage = {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
  let data = { ...demo(), owner };
  const calls = { read: 0, write: 0, connect: 0 };
  const adapter = {
    chainId: 61999,
    connect: async () => {
      calls.connect++;
      return owner;
    },
    accounts: async () => [owner],
    chain: async () => 61999,
    read: async () => {
      calls.read++;
      return JSON.stringify(data);
    },
    write: async () => {
      calls.write++;
      return hash;
    },
    wait: async () => finalized,
    transaction: async () => ({ to_address: address }),
  };
  const s = new LedgerSession({ adapter, storage });
  return { s, adapter, storage, calls, values, data };
}
async function loaded() {
  const f = fixture();
  await f.s.load(address);
  return f;
}
test("public read needs no wallet", async () => {
  const { s, calls } = await loaded();
  assert.equal(s.address, address);
  assert.equal(calls.connect, 0);
});
test("successful write tracks finality and reads back", async () => {
  const { s, calls } = await loaded();
  await s.write("reserve", [1, "A", 1, "ref"]);
  assert.equal(calls.write, 1);
  assert.equal(calls.read, 2);
  assert.equal(s.pending(), null);
  assert.equal(s.stale, false);
});
test("rejected wallet request does not create pending ID", async () => {
  const { s, adapter, calls } = await loaded();
  adapter.connect = async () => {
    throw Object.assign(Error("Declined"), { code: 4001 });
  };
  await assert.rejects(() => s.write("reserve", []), /Declined/);
  assert.equal(s.pending(), null);
  assert.equal(calls.write, 0);
  assert.equal(s.locked, false);
});
test("other wallet cannot sign registrar actions", async () => {
  const { s, adapter, calls } = await loaded();
  adapter.connect = async () => other;
  adapter.accounts = async () => [other];
  await assert.rejects(() => s.write("reserve", []), /registrar/);
  assert.equal(calls.write, 0);
});
test("wrong chain blocked before signature", async () => {
  const { s, adapter, calls } = await loaded();
  adapter.chain = async () => 1;
  await assert.rejects(() => s.write("reserve", []), /Studionet/);
  assert.equal(calls.write, 0);
});
test("account change between connect and write is blocked", async () => {
  const { s, adapter, calls } = await loaded();
  adapter.accounts = async () => [other];
  await assert.rejects(() => s.write("reserve", []), /Wallet changed/);
  assert.equal(calls.write, 0);
});
test("timeout retains ID; reload resumes without new write", async () => {
  const { s, adapter, storage, calls } = await loaded();
  adapter.wait = async () => {
    throw Error("Timeout");
  };
  await assert.rejects(() => s.write("reserve", []), /Resume tracking/);
  assert.equal(s.pending().hash, hash);
  await assert.rejects(() => s.write("reserve", []), /Resume the existing/);
  const refreshed = new LedgerSession({ adapter, storage });
  await refreshed.load(address);
  adapter.wait = async () => finalized;
  await refreshed.resume();
  assert.equal(calls.write, 1);
  assert.equal(refreshed.pending(), null);
});
test("failed new contract read clears old state binding", async () => {
  const { s, adapter } = await loaded();
  adapter.read = async () => {
    throw Error("RPC unavailable");
  };
  await assert.rejects(() => s.load(other), /RPC/);
  assert.equal(s.state, null);
  assert.equal(s.address, other);
  await assert.rejects(() => s.write("reserve", []), /Read a deployed/);
});
test("finalized contract error clears pending and refreshes ledger", async () => {
  const { s, adapter, calls } = await loaded();
  adapter.wait = async () => ({
    statusName: "FINALIZED",
    txExecutionResultName: "FINISHED_WITH_ERROR",
  });
  await assert.rejects(() => s.write("reserve", []), /without success/);
  assert.equal(s.pending(), null);
  assert.equal(calls.read, 2);
});
test("successful write with read-back outage remains resumable", async () => {
  const { s, adapter, calls } = await loaded();
  const read = adapter.read;
  adapter.read = async () => {
    throw Error("Read outage");
  };
  await assert.rejects(
    () => s.write("reserve", []),
    /finalized successfully, but/,
  );
  assert.equal(s.pending().hash, hash);
  assert.equal(s.stale, true);
  adapter.read = read;
  await s.resume();
  assert.equal(calls.write, 1);
  assert.equal(s.pending(), null);
});
test("pending IDs are isolated by deployment", async () => {
  const { s, adapter, storage } = await loaded();
  adapter.wait = async () => {
    throw Error("Timeout");
  };
  await assert.rejects(() => s.write("reserve", []));
  const second = new LedgerSession({ adapter, storage });
  await second.load(other);
  assert.equal(second.pending(), null);
  await second.load(address);
  assert.equal(second.pending().hash, hash);
});
test("double click cannot submit twice", async () => {
  const { s, adapter, calls } = await loaded();
  let resolve;
  const barrier = new Promise((r) => (resolve = r));
  adapter.wait = async () => {
    await barrier;
    return finalized;
  };
  const first = s.write("reserve", []);
  await assert.rejects(() => s.write("reserve", []), /current action/);
  resolve();
  await first;
  assert.equal(calls.write, 1);
});
test("manual recovery refuses an unrelated transaction", async () => {
  const { s, adapter } = await loaded();
  adapter.transaction = async () => ({ recipient: other });
  await assert.rejects(() => s.resume(hash), /recipient/);
  assert.equal(s.pending(), null);
});
test("bad local data does not crash config parsing or permit unsafe writes", async () => {
  const { s, storage, calls } = await loaded();
  storage.setItem("config", "bad json");
  assert.deepEqual(readJSON(storage, "config", {}), {});
  storage.setItem(s.key(), "bad json");
  await assert.rejects(() => s.write("reserve", []), /unreadable/);
  assert.equal(calls.write, 0);
});
test("invalid state or over-cap snapshot is rejected", () => {
  const data = { ...demo(), owner };
  data.reservations[0].amount = 999999;
  assert.throws(() => validateSnapshot(data), /cap/);
  data.reservations = [];
  data.costs[0].cap = -1;
  assert.throws(() => validateSnapshot(data), /expense/);
});


test('malformed new address cannot retain a previous ledger',async()=>{
 const {s}=await loaded();
 await assert.rejects(()=>s.load('not-an-address'),/valid deployed/);
 assert.equal(s.state,null);
 assert.equal(s.address,null);
});
