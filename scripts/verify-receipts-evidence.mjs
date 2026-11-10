// One-command reviewer check for the GrantWeave receipts milestone.
// No wallet keys needed: reads the committed evidence index and re-reads
// every transaction and the deployed contract code from the public RPC.
// Usage: node scripts/verify-receipts-evidence.mjs
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { getAddress } from 'viem';
import { normalizeReceipt, successful, validateSnapshot } from '../src/model.js';

const evidence = JSON.parse(await readFile('evidence/receipts-evidence.json', 'utf8'));
const expected = JSON.parse(await readFile('evidence/receipts-expected.json', 'utf8'));
const source = await readFile('public/contracts/grant_overlap_receipts.py', 'utf8');
const sourceSha256 = createHash('sha256').update(source).digest('hex');
const client = createClient({ chain: studionet });
const address = getAddress(evidence.contractAddress);
let checks = 0;
const check = (label, cond) => { assert.ok(cond, label); checks++; console.log('ok', label); };

// 1. The deployed code is byte-identical to the reviewed source.
const deployed = await client.getContractCode(address);
check('deployed code SHA-256 equals source SHA-256', createHash('sha256').update(deployed).digest('hex') === sourceSha256);
check('evidence source SHA-256 equals source SHA-256', evidence.sourceSha256 === sourceSha256);
check('source length matches evidence', source.length === evidence.sourceLength);

// 2. Every evidence transaction is FINALIZED with the claimed outcome.
for (const step of evidence.steps) {
  const receipt = normalizeReceipt(await client.waitForTransactionReceipt({ hash: step.transactionHash, status: 'FINALIZED', interval: 5000, retries: 24, fullTransaction: true }));
  check(`${step.name}: FINALIZED`, receipt.statusName === 'FINALIZED');
  check(`${step.name}: outcome ${step.expectedSuccess ? 'success' : 'rejected'} as recorded`, successful(receipt) === step.expectedSuccess);
  const tx = await client.getTransaction({ hash: step.transactionHash });
  check(`${step.name}: recipient is the receipts contract`, (tx.to_address || tx.recipient || '').toLowerCase() === address.toLowerCase());
}

// 3. The live snapshot matches the pre-registered expectations.
const snapshot = validateSnapshot(await client.readContract({ address, functionName: 'snapshot', args: [], transactionHashVariant: 'latest-final' }));
check('snapshot schema is 3', snapshot.schema === 3);
check('final receipts match EXPECTED', JSON.stringify(snapshot.receipts) === JSON.stringify(expected.finalReceipts));
check('final reservations match EXPECTED', JSON.stringify(snapshot.reservations) === JSON.stringify(expected.finalReservations));
check('final costs match EXPECTED', snapshot.costs.length === expected.costCount && snapshot.costs.every(c => c.description && c.cap > 0));
check('final proposals match EXPECTED', snapshot.proposals.length === expected.proposalCount);
check('spent total matches EXPECTED', snapshot.receipts.reduce((n, r) => n + r.amount, 0) === expected.spentTotal);
console.log(`\n${checks} checks passed. Contract ${address} matches the committed evidence.`);
process.exit(0);
