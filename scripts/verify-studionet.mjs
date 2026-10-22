import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { normalizeReceipt, successful, validateSnapshot, used } from "../src/model.js";

const deployment = JSON.parse(await readFile("deployments/studionet.json", "utf8"));
const key = process.env.GRANTWEAVE_PRIVATE_KEY;
if (!key) throw Error("Set GRANTWEAVE_PRIVATE_KEY for the deployment registrar");
const account = createAccount(key);
assert.equal(account.address.toLowerCase(), deployment.registrar.toLowerCase());
const client = createClient({ chain: studionet, account });
const path = "deployments/studionet-verification.json";
let evidence;
try { evidence = JSON.parse(await readFile(path, "utf8")); }
catch (e) { if (e.code !== "ENOENT") throw e; evidence = {
  chainId: studionet.id, contractAddress: deployment.contractAddress,
  registrar: account.address, valueTransferred: "0", steps: [],
}; }
assert.equal(evidence.contractAddress, deployment.contractAddress);
const save = () => writeFile(path, JSON.stringify(evidence, null, 2) + "\n");
const snapshot = async () => validateSnapshot(await client.readContract({
  address: deployment.contractAddress, functionName: "snapshot", args: [],
  transactionHashVariant: "latest-final",
}));
async function step(name, functionName, args, expectedSuccess, check) {
  let entry = evidence.steps.find((x) => x.name === name);
  if (entry?.verified) return;
  if (!entry) {
    const before = await snapshot();
    const hash = await client.writeContract({ address: deployment.contractAddress,
      functionName, args, value: 0n, leaderOnly: false });
    entry = { name, functionName, args, expectedSuccess, transactionHash: hash, before };
    evidence.steps.push(entry);
    await save();
    console.log(`${name}: submitted ${hash}`);
  }
  const r = normalizeReceipt(await client.waitForTransactionReceipt({
    hash: entry.transactionHash, status: "FINALIZED", interval: 5000,
    retries: 60, fullTransaction: true,
  }));
  const leaders = r.consensus_data?.leader_receipt || [];
  entry.receipt = { status: r.statusName, execution: r.txExecutionResultName,
    result: r.result_name || r.resultName, votes: r.consensus_data?.votes,
    leaders: leaders.map((x) => ({ mode: x.mode, execution: x.execution_result,
      result: x.result, equivalenceOutputs: x.eq_outputs })) };
  await save();
  assert.equal(r.statusName, "FINALIZED");
  assert.equal(successful(r), expectedSuccess, `${name}: unexpected execution outcome`);
  entry.after = await snapshot();
  if (!expectedSuccess) assert.deepEqual(entry.after, entry.before);
  check(entry.after);
  entry.verified = true;
  await save();
  console.log(`${name}: verified`);
}
await step("register-microscope", "register_cost", [
  "One workshop microscope", "Synthetic test invoice LAB-104. Supplier: North Lab Tools. One microscope model M1 delivered 2026-10-01 to Community Workshop. Total USD 1200.00. This is the full single purchase, no other items.", 120000,
], true, (s) => assert.equal(s.costs.length, 1));
await step("reject-renamed-duplicate", "register_cost", [
  "Optical research equipment for the workshop", "Synthetic test invoice LAB-104. Supplier: North Lab Tools. Exactly the same one microscope model M1 delivered 2026-10-01 to Community Workshop, total USD 1200.00, already registered. No additional purchase.", 120000,
], false, (s) => assert.equal(s.costs.length, 1));
await step("register-distinct-hall", "register_cost", [
  "Community hall hire for two evenings", "Synthetic test invoice HALL-22. Supplier: East Hall Association. Rental of Hall B on 2026-11-12 and 2026-11-13, total USD 400.00. No laboratory equipment, no microscope, independent supplier and invoice from LAB-104.", 40000,
], true, (s) => assert.equal(s.costs.length, 2));
await step("reserve-first-source", "reserve", [1, "Community science fund", 70000, "SCI-001"], true,
  (s) => assert.equal(used(s, 1), 70000));
await step("reserve-second-source", "reserve", [1, "Local sponsor", 50000, "LOCAL-001"], true,
  (s) => assert.equal(used(s, 1), 120000));
await step("reject-over-cap", "reserve", [1, "Excess sponsor", 1, "OVER-001"], false,
  (s) => assert.equal(used(s, 1), 120000));
await step("release-first-source", "release", [1], true, (s) => {
  assert.equal(used(s, 1), 50000);
  assert.equal(s.reservations[0].active, false);
  assert.equal(s.reservations.length, 2);
});
evidence.completedAt = new Date().toISOString();
evidence.finalSnapshot = await snapshot();
await save();
console.log("All seven Studio Network checks verified");
process.exit(0);
