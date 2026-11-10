import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createAccount, createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { generatePrivateKey } from 'viem/accounts';
import { getAddress } from 'viem';
import { normalizeReceipt, successful, validateSnapshot, used, spent } from '../src/model.js';

// Receipts milestone: a fresh ledger where the project party settles each
// reservation with a spend receipt. Consensus checks the receipt text against
// the funder-approved cost facts; spent amounts stay committed to the cap.
// Wallet keys come from GRANTWEAVE_RECEIPTS_*_KEY, or fresh test wallets are
// generated and funded with sim_fundAccount (test GEN only, zero transfer
// value on every contract write). Generated keys are checkpointed to
// deployments/.receipts-keys.json (0600, gitignored) and deleted after the
// flow completes; they are never written into evidence.
const RPC = 'https://studio.genlayer.com/api';
const keysPath = 'deployments/.receipts-keys.json';
const load = async p => { try { return JSON.parse(await readFile(p, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; return null; } };
const save = (p, s) => writeFile(p, JSON.stringify(s, null, 2) + '\n');
await mkdir('deployments', { recursive: true });
await mkdir('evidence', { recursive: true });
let keys = {
  project: process.env.GRANTWEAVE_RECEIPTS_PROJECT_KEY,
  a: process.env.GRANTWEAVE_RECEIPTS_FUNDER_A_KEY,
  b: process.env.GRANTWEAVE_RECEIPTS_FUNDER_B_KEY,
};
if (!Object.values(keys).every(k => /^0x[0-9a-fA-F]{64}$/.test(k || ''))) {
  const saved = await load(keysPath);
  if (saved && Object.values(saved).every(k => /^0x[0-9a-fA-F]{64}$/.test(k || ''))) {
    keys = saved;
    console.log('Resumed checkpointed test wallets');
  } else {
    keys = Object.fromEntries(Object.entries({ project: 0, a: 0, b: 0 }).map(([role]) => [role, generatePrivateKey()]));
    await writeFile(keysPath, JSON.stringify(keys, null, 2) + '\n', { mode: 0o600 });
    await chmod(keysPath, 0o600);
    for (const [role, key] of Object.entries(keys)) {
      const account = createAccount(key);
      const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'sim_fundAccount', params: [account.address, 100000000000000000000], id: 1 }) });
      const body = await r.json();
      if (body.error) throw Error(`Funding ${role} failed: ${body.error.message}`);
      console.log('Funded test wallet', role, account.address);
    }
  }
}
const accounts = Object.fromEntries(Object.entries(keys).map(([role, key]) => [role, createAccount(key)]));
const clients = Object.fromEntries(Object.entries(accounts).map(([role, account]) => [role, createClient({ chain: studionet, account })]));
const addr = role => accounts[role].address.toLowerCase();
const path = 'deployments/studionet-receipts.json';
const source = await readFile('public/contracts/grant_overlap_receipts.py', 'utf8');
const sourceSha256 = createHash('sha256').update(source).digest('hex');
let deployment = await load(path);
if (!deployment) {
  const args = ['GrantWeave Shared Approval Ledger', 'USD', accounts.a.address, accounts.b.address];
  const hash = await clients.project.deployContract({ code: source, args, leaderOnly: false });
  deployment = { schema: 3, chainId: 61999, network: 'studionet', project: args[0], currency: args[1], sourceSha256, constructorArgs: args,
    projectParty: accounts.project.address, funders: [accounts.a.address, accounts.b.address], transactionHash: hash, status: 'submitted', valueTransferred: '0' };
  await save(path, deployment); console.log('Deployment submitted', hash);
}
assert.equal(deployment.sourceSha256, sourceSha256);
assert.equal(deployment.projectParty.toLowerCase(), addr('project'));
assert.deepEqual(deployment.funders.map(x => x.toLowerCase()), [addr('a'), addr('b')]);
const wait = async (client, hash) => normalizeReceipt(await client.waitForTransactionReceipt({ hash, status: 'FINALIZED', interval: 5000, retries: 120, fullTransaction: true }));
if (deployment.status !== 'FINALIZED') {
  const r = await wait(clients.project, deployment.transactionHash);
  deployment.status = r.statusName; deployment.execution = r.txExecutionResultName;
  deployment.contractAddress = r.txDataDecoded?.contractAddress || r.data?.contract_address;
  await save(path, deployment); assert.ok(successful(r));
}
const address = getAddress(deployment.contractAddress);
const snapshot = async () => validateSnapshot(await clients.project.readContract({ address, functionName: 'snapshot', args: [], transactionHashVariant: 'latest-final' }));
assert.equal((await snapshot()).project_party, addr('project'));
const evidencePath = 'deployments/studionet-receipts-verification.json';
let evidence = await load(evidencePath) || { schema: 3, chainId: 61999, contractAddress: address, sourceSha256, sourceLength: source.length,
  projectParty: accounts.project.address, funders: deployment.funders, valueTransferred: '0',
  testScope: 'Three controlled test wallets verify address-based permissions; they do not represent independent organizations. Model decisions are real network results; invoice facts are synthetic.', steps: [] };
assert.equal(evidence.contractAddress, address);
async function step(group, name, role, functionName, args, expectedSuccess, check) {
  let entry = evidence.steps.find(x => x.name === name); if (entry?.verified) return;
  if (!entry) { const before = await snapshot(); const hash = await clients[role].writeContract({ address, functionName, args, value: 0n, leaderOnly: false });
    entry = { group, name, caller: accounts[role].address, functionName, args, value: '0', expectedSuccess, transactionHash: hash, before }; evidence.steps.push(entry); await save(evidencePath, evidence); console.log(name, 'submitted', hash); }
  const r = await wait(clients[role], entry.transactionHash);
  const raw = r.consensus_data?.leader_receipt; const leaders = Array.isArray(raw) ? raw : raw ? [raw] : [];
  entry.receipt = { status: r.statusName, execution: r.txExecutionResultName, result: r.resultName, votes: r.consensus_data?.votes,
    leaders: leaders.map(x => ({ mode: x.mode, execution: x.execution_result, result: x.result, equivalenceOutputs: x.eq_outputs })) };
  await save(evidencePath, evidence); assert.equal(r.statusName, 'FINALIZED');
  assert.equal(successful(r), expectedSuccess, name + ': unexpected result');
  entry.after = await snapshot(); if (!expectedSuccess) assert.deepEqual(entry.after, entry.before); check?.(entry.after); entry.verified = true; await save(evidencePath, evidence); console.log(name, 'verified');
}
const invoice = 'Synthetic test invoice LAB-104. Supplier North Lab Tools. One microscope model M1 delivered 2026-10-01 to Community Workshop. Full single purchase USD 1200.00. No other items.';
const receipt = (reservation, supplier, invoiceId, amount, period) => [reservation, supplier, invoiceId, amount, period];
// Journey: each receipt settles its cost in full, so the receipt amount always
// equals the reserved amount and the approved cap. Negatives are attempted on
// the active reservation before the matching receipt settles it.
await step('journey', 'propose-microscope', 'project', 'propose_cost', ['One workshop microscope', invoice, 120000], true, s => assert.equal(s.proposals.length, 1));
await step('journey', 'approve-microscope-a', 'a', 'approve_cost', [1], true);
await step('journey', 'approve-microscope-b', 'b', 'approve_cost', [1], true);
await step('journey', 'activate-microscope', 'project', 'activate_cost', [1], true, s => assert.equal(s.costs.length, 1));
await step('journey', 'reserve-a-120000', 'a', 'reserve', [1, 120000, 'A-001'], true, s => assert.equal(s.reservations[0].funder, addr('a')));
// Negative cases: each must fail with the ledger unchanged.
await step('negative', 'reject-wrong-amount', 'project', 'submit_receipt', receipt(1, 'North Lab Tools', 'LAB-104', 119999, '2026-10-01'), false);
await step('negative', 'reject-wrong-supplier', 'project', 'submit_receipt', receipt(1, 'East Hall Association', 'LAB-104', 120000, '2026-10-01'), false);
await step('negative', 'reject-uncertain-receipt', 'project', 'submit_receipt', receipt(1, 'North Lab Tools', 'LAB-104', 120000, '2026'), false);
await step('negative', 'reject-funder-submit', 'a', 'submit_receipt', receipt(1, 'North Lab Tools', 'LAB-104', 120000, '2026-10-01'), false);
await step('journey', 'receipt-1-matching', 'project', 'submit_receipt', receipt(1, 'North Lab Tools', 'LAB-104', 120000, '2026-10-01'), true, s => {
  assert.equal(s.receipts.length, 1); assert.equal(s.receipts[0].status, 'SPENT');
  assert.equal(s.reservations[0].active, false); assert.equal(s.reservations[0].spent, true);
});
await step('negative', 'reject-over-cap-after-settlement', 'b', 'reserve', [1, 1, 'OVER-001'], false);
await step('negative', 'reject-duplicate-receipt', 'project', 'submit_receipt', receipt(1, 'North Lab Tools', 'LAB-104', 120000, '2026-10-01'), false);
// Regression on the new contract: second cost settled in full, third cost released.
const hall = 'Synthetic test invoice HALL-22 issued by East Hall Association on 2026-10-15. Purchase category: venue rental service. Booking HALL-B-NOV12-13. Deliverable: exclusive use of Hall B, 20 River Road, for the two sessions 2026-11-12 18:00-22:00 and 2026-11-13 18:00-22:00. Quantity two evenings at USD 200.00 each, total USD 400.00.';
await step('regression', 'propose-hall', 'b', 'propose_cost', ['Community hall hire', hall, 40000], true);
await step('regression', 'approve-hall-a', 'a', 'approve_cost', [2], true);
await step('regression', 'approve-hall-b', 'b', 'approve_cost', [2], true);
await step('regression', 'activate-hall', 'b', 'activate_cost', [2], true, s => assert.equal(s.costs.length, 2));
await step('regression', 'reserve-hall-a', 'a', 'reserve', [2, 40000, 'HALL-A-001'], true);
await step('journey', 'receipt-2-matching', 'project', 'submit_receipt', receipt(2, 'East Hall Association', 'HALL-22', 40000, '2026-11-12 to 2026-11-13'), true, s => {
  assert.equal(s.receipts.length, 2); assert.equal(spent(s, 2), 40000); assert.equal(used(s, 2), 0);
});
const supplies = 'Synthetic invoice SUP-07. Supplier Office Depot Direct. Printer paper A4 20 reams and toner cartridges, delivered 2026-10-20, USD 100.00. No microscope or venue costs.';
await step('regression', 'propose-supplies', 'project', 'propose_cost', ['Printer paper and toner', supplies, 10000], true);
await step('regression', 'approve-supplies-a', 'a', 'approve_cost', [3], true);
await step('regression', 'approve-supplies-b', 'b', 'approve_cost', [3], true);
await step('regression', 'activate-supplies', 'project', 'activate_cost', [3], true, s => assert.equal(s.costs.length, 3));
await step('regression', 'reserve-supplies-b', 'b', 'reserve', [3, 10000, 'SUP-B-001'], true);
await step('regression', 'release-supplies', 'b', 'release', [3], true, s => assert.equal(s.reservations[2].active, false));
await step('negative', 'reject-receipt-on-released', 'project', 'submit_receipt', receipt(3, 'Office Depot Direct', 'SUP-07', 10000, '2026-10-20'), false);
await step('regression', 'propose-renamed-duplicate', 'a', 'propose_cost', ['Optical research equipment', invoice + ' This is exactly the same LAB-104 purchase already registered, with no additional items.', 120000], true);
await step('regression', 'approve-duplicate-a', 'a', 'approve_cost', [4], true);
await step('regression', 'approve-duplicate-b', 'b', 'approve_cost', [4], true);
await step('regression', 'reject-duplicate-activation', 'project', 'activate_cost', [4], false, s => assert.equal(s.costs.length, 3));
evidence.completedAt = new Date().toISOString(); evidence.finalSnapshot = await snapshot();
evidence.observations = evidence.steps.filter(x => x.receipt?.result === 'MAJORITY_DISAGREE').map(x => ({ transactionHash: x.transactionHash, name: x.name, description: 'Leader result did not reach validator agreement. The transaction did not commit state; the ledger is unchanged.' }));
await save(evidencePath, evidence);
// Split the working evidence into the committed per-group files + combined index.
const header = { schema: 3, chainId: 61999, contractAddress: address, sourceSha256, sourceLength: source.length,
  projectParty: accounts.project.address, funders: deployment.funders, valueTransferred: '0',
  testScope: evidence.testScope, completedAt: evidence.completedAt, finalSnapshot: evidence.finalSnapshot,
  observations: evidence.observations };
const groups = { journey: 'receipts-journey', negative: 'receipts-negative-cases', regression: 'receipts-regression' };
for (const [group, file] of Object.entries(groups)) {
  await save(`evidence/${file}.json`, { ...header, steps: evidence.steps.filter(x => x.group === group) });
}
await save('evidence/receipts-evidence.json', { ...header, steps: evidence.steps });
await save('public/studionet-receipts-verification.json', { ...header, steps: evidence.steps });
console.log('All', evidence.steps.length, 'receipts chain checks verified', address);
console.log('Evidence written: evidence/receipts-{journey,negative-cases,regression,evidence}.json + public/studionet-receipts-verification.json');
process.exit(0);
