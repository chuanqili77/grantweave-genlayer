# Expected results — GrantWeave receipts milestone

Pre-registered before the evidence run completed. Each expectation is a
deterministic outcome of the contract logic: a receipt is recorded only when
consensus returns SAME, and every rejection leaves the ledger unchanged.
`evidence/receipts-expected.json` carries the same expectations in
machine-readable form for `scripts/verify-receipts-evidence.mjs`.

## Ledger shape

- Contract schema is 3. Project `GrantWeave Shared Approval Ledger`, currency USD.
- 4 proposals: #1 microscope ACTIVE (cost 1), #2 hall ACTIVE (cost 2),
  #3 supplies ACTIVE (cost 3), #4 renamed duplicate PENDING (activation refused).
- 3 costs: #1 microscope cap 120000, #2 hall cap 40000, #3 supplies cap 10000.
- 3 reservations, 2 receipts, spent total 160000, active reserved 0.

## Receipts

- Receipt #1: reservation 1, cost 1, supplier `North Lab Tools`, invoice
  `LAB-104`, amount 120000, period `2026-10-01`, status SPENT.
- Receipt #2: reservation 2, cost 2, supplier `East Hall Association`,
  invoice `HALL-22`, amount 40000, period `2026-11-12 to 2026-11-13`,
  status SPENT.

## Reservations

- Reservation #1 (funder A, cost 1, 120000, `A-001`): active false,
  spent true, receipt_id 1.
- Reservation #2 (funder A, cost 2, 40000, `HALL-A-001`): active false,
  spent true, receipt_id 2.
- Reservation #3 (funder B, cost 3, 10000, `SUP-B-001`): active false,
  spent false, receipt_id null (released, never settled).

## Rejections (all leave the ledger unchanged)

- Wrong amount (119999 against a 120000 reservation): rejected.
- Wrong supplier (`East Hall Association` on the LAB-104 receipt): rejected.
- Uncertain receipt (period `2026`, year only): rejected.
- Funder submitting a receipt: rejected (project party only).
- Second receipt for reservation 1: rejected (already recorded).
- Reserve 1 more minor unit after the 120000 settlement: rejected
  (spent amounts stay committed to the cap).
- Receipt for the released reservation 3: rejected.
- Activating the renamed duplicate proposal: rejected (SAME as cost 1).

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
