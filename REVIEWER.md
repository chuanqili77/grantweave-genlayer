# Reviewer guide — GrantWeave spend receipts

## What changed

V2 was capacity bookkeeping only: propose → approve → activate → reserve →
release, with no proof the money was actually spent. This milestone closes the
lifecycle. After a reservation is made, the project party submits a receipt
(supplier, invoice id, amount, period) and consensus checks it against the
funder-approved cost facts. A matching receipt settles the reservation as
SPENT; anything else is rejected and the reservation stays active. Spent
amounts stay committed to the cost cap, so settling never frees capacity for
a second spend.

- New contract `0xB34F2e0867D4Ef3cE91E17D407a5D76c9949e4f3`
  (deploy tx `0x91e307e4678b1bc3deae460a938262ae1e4327d47567b6b2e5f171cee7bb7586`),
  source `public/contracts/grant_overlap_receipts.py`, schema 3.
  The V2 contract `0x905A5Fb6212677d43cc2f4CdE75A36069e8136f6` stays deployed
  and untouched; the V1 contract is legacy.
- The receipts contract is published byte-identical in two places:
  `public/contracts/grant_overlap_receipts.py` here and
  `contracts/grant_overlap_receipts.py` in
  [grant-overlap-primitive](https://github.com/chuanqili77/grant-overlap-primitive).
  Both copies share SHA-256 `d38e3cdd4b9682377d40ba89156b7e2460a8321a7f9de242a517b8acfc920561`.
- New write `submit_receipt(reservation_id, supplier, invoice_id, amount, period)`:
  project party only; the reservation must be active and unspent; the receipt
  amount must equal the reserved amount (deterministic gates first). The
  consensus check reuses the activation machinery — leader/validator exact
  agreement on one SAME/DISTINCT/UNCERTAIN classification of the receipt
  against the approved cost record. Only SAME settles the reservation.
- `reserve()` now counts spent receipt amounts against the cap alongside
  active reservations. `release()` refuses a settled reservation.
- Frontend: a receipts form and receipts list, a SPENT stat, spent status in
  funding history, and the full contract address in the footer (runtime-loaded
  from `deployment.json`, linked to the explorer). All reads pin to
  `latest-final`. New receipts strings are bilingual (English + Chinese);
  the rest of the UI is English-only — a full retrofit is 124 user-visible
  strings and is a separate decision, not claimed here.

## How to verify (one command)

```sh
node scripts/verify-receipts-evidence.mjs
```

It needs no wallet keys. It re-reads every evidence transaction from the
public RPC, checks each one is FINALIZED with the recorded outcome and the
receipts contract as recipient, checks the deployed code is byte-identical to
the reviewed source via `getContractCode`, and checks the live snapshot
against the pre-registered `evidence/EXPECTED.md` /
`evidence/receipts-expected.json`.

## Evidence

- `evidence/receipts-evidence.json` — combined index, all steps.
- `evidence/receipts-journey.json` — reserve → matching receipt → SPENT,
  twice (microscope 120000, hall 40000).
- `evidence/receipts-negative-cases.json` — wrong amount, wrong supplier,
  uncertain receipt, funder submit, duplicate receipt, over-cap reserve
  after settlement, receipt on a released reservation. Each failed with the
  ledger unchanged.
- `evidence/receipts-regression.json` — the full V2 flow on the new contract
  (propose → both funders approve → activate → reserve → release) plus a
  renamed duplicate refused by consensus.
- `evidence/EXPECTED.md` — pre-registered expected final state.
- `public/studionet-receipts-verification.json` — the combined index, served
  with the site.

## Tests

- App: `npm test` (28 tests, incl. 4 receipts unit tests),
  `npm run test:browser` (demo, simulated live, V2, receipts UI).
- Primitive: `python3 -m unittest discover -s tests` (46 tests, incl. 14
  receipts tests with mocked GenVM), `pytest tests/direct -q` (30 tests,
  incl. 9 receipts tests with SDK storage and mocked model responses).
- `genvm-lint check contracts/grant_overlap_receipts.py` passes; the ABI is
  `contracts/grant_overlap_receipts.abi.json` in the primitive repo.

## What this does NOT prove

- A matching receipt proves the receipt text matches the funder-approved
  cost facts. It does NOT certify the supplier invoice is genuine, that the
  goods were delivered, or that the purchase happened off-chain.
- The three test wallets are controlled addresses, not independent
  organizations. They prove address-based permissions, not real-world
  independence or non-collusion.
- Consensus judges the supplied text. A false invoice that textually matches
  the approved facts would still settle; the check is equivalence against
  approved facts, not external verification.
- The UI is English-only except the new receipts strings, which are
  bilingual. A full bilingual UI is not part of this milestone.
