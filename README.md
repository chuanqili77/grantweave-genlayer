# GrantWeave

A shared expense ledger for small projects with two funders. Both funders approve fixed invoice facts and a cap before an expense can activate. GenLayer compares the proposal against the latest active ledger and blocks duplicate or uncertain overlaps, even when both funders approved. Each funder signs and controls its own reservations.

## Public deployment

- [Live application](https://chuanqili77.github.io/grantweave-genlayer/)
- [Reusable contract](https://github.com/chuanqili77/grant-overlap-primitive)
- Studio Network: `61999`
- [V2 contract](https://explorer-studio.genlayer.com/address/0x905A5Fb6212677d43cc2f4CdE75A36069e8136f6): `0x905A5Fb6212677d43cc2f4CdE75A36069e8136f6`
- [Deployment record](./public/deployment.json)
- [V2 network verification](./public/studionet-v2-verification.json)
- Deployment transaction: `0x131839e89ba89541cef2f2eb066e348849d37b7d2ec949e7561f9d9fa539a448`

Switch to live and click **Read contract**. Anyone can inspect participants, proposal approvals, active expense capacity and funding history without connecting a wallet. The public ledger uses three controlled test wallets to exercise permissions, not three independent organizations. Invoice facts are synthetic; test transactions transfer zero value.

The V2 verification records 25 finalized test calls. It includes denied project self-approval, one-approval activation, cross-funder release, over-cap reservation and an approved duplicate rejected by semantic consensus. One venue activation received MAJORITY_DISAGREE and left state unchanged; a new proposal with clarified booking facts received fresh approvals and activated successfully. Both outcomes are retained in the evidence.

## Use a V2 ledger

1. Deploy `public/contracts/grant_overlap_v2.py` from the project party's wallet in GenLayer Studio. Constructor arguments: project name, supported uppercase currency, funder A address and funder B address. All three wallets must have distinct, nonzero addresses. The parties cannot be replaced after deployment.
2. Switch to live, enter the deployed address and click **Read contract**. Connect a participant wallet; the participant panel displays its role.
3. The project party or either funder submits **Propose an expense** with description, supporting invoice facts and total cap. Amounts use two decimal places, for example `1200.00` USD.
4. Each funder connects its own wallet and clicks **Approve as funder**. The UI displays each approval and the `0/2`, `1/2` or `2/2` progress. The project party cannot approve for either funder.
5. After both approvals, any participant clicks **Check & activate**. The contract compares against the latest active expenses. A duplicate or uncertain result leaves the proposal pending without creating capacity. Approved facts and caps cannot be edited.
6. A funder selects an active expense and reserves an amount with its reference. The contract records the signing wallet as the funder. That wallet alone can release the reservation, preserving its history.
7. Use **Export ledger** to download the current snapshot with mode, chain ID, contract address, freshness and export time.

After another participant writes, click **Read contract** to refresh before continuing. Button availability reflects the last loaded snapshot; the contract always enforces the final permission and state checks.

## Transaction recovery

The app requires FINALIZED, a successful return and an agreeing consensus result before reading the ledger back as success. A leader return with MAJORITY_DISAGREE is a failed transaction, even after finalization. Pending transaction IDs are saved per chain and contract.

If tracking times out, use **Resume pending transaction**. Never resubmit blindly. A finalized write whose read-back fails stays resumable, and another write is blocked until recovery succeeds. If the ID was not saved locally, paste it into **Existing transaction ID** and click **Track transaction**; its recipient must match the loaded contract. Wallet and network changes require reconnection before another write.

## Accounting demo

The initial page uses illustrative accounting fixtures, without blockchain writes. Try a reservation, exceed remaining capacity, release a reservation or export the demo ledger. Proposal activation and semantic checks require live GenLayer; they are not simulated as real consensus. Demo data resets on reload.

## Run and verify

```sh
npm ci
npm run dev
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

Unit tests cover amount parsing, schema validation, funder permissions, immutable approval links, pending recovery and successful execution classification. Browser checks cover the production accounting demo and responsive layout, then use a test-only adapter for V1 recovery and V2 role changes, two-wallet approval, activation and owner-only release. Simulated UI results are not network evidence. Set `LIVE_CONTRACT_ADDRESS` to additionally check a real public V2 read and live JSON export; this requires browser access to the Studio RPC endpoint. Use `PLAYWRIGHT_EXECUTABLE_PATH` for an existing Chromium, or `APP_URL` and `DEV_URL` for existing local servers.

The relative Vite base supports GitHub Pages repository paths. GenLayerJS `1.1.8` and viem `2.57.8` are pinned. The client targets Studio Network 61999. The public contract copies are byte-identical to their standalone primitive sources.

## Network verification and publishing

`npm run verify:v2` deploys a fresh V2 test ledger if no local V2 record exists, then runs a resumable verification sequence. Set `GRANTWEAVE_PRIVATE_KEY`, `GRANTWEAVE_FUNDER_A_KEY` and `GRANTWEAVE_FUNDER_B_KEY` to three selected test wallets. Keys are read from environment variables and are never written into evidence. The script saves transaction IDs before tracking, sends zero transfer value, verifies expected rejections leave state unchanged, and records narrowed receipts, validator votes and before/after snapshots, including observed consensus disagreements in `deployments/`. Running it again resumes saved transactions rather than repeating verified steps. Do not use the fixture sequence against an unrelated existing project.

The **Check** workflow runs unit, build and browser checks. **Publish Pages** builds and publishes `dist/` on pushes to `main`. A favicon, SVG logo and 512 × 512 PNG logo are included in `public/`.

## Trust and limitations

V2 removes the project party's unilateral ability to approve costs or manage funder reservations. It does not establish independent ownership of the addresses, prevent collusion, certify invoice authenticity or discover omitted external funding. Either funder can block activation by withholding approval. Membership is fixed, there is no administrator override, and abandoned proposals still consume the bounded proposal limit.

This is capacity bookkeeping, not fund transfer, escrow or official grant approval. Semantic errors remain possible; uncertainty fails closed. Partially overlapping purchases require clarified proposals. Do not publish private invoice data.

## Legacy V1

Schema 1 remains readable and writable by its registrar. Its funding source labels do not constitute funder consent. The old instance is preserved at `0x87cB0341BDd533338e00A9E7F29dDd0396857A27`; [deployment](./public/deployment-v1.json) and [network evidence](./public/studionet-verification.json) are labeled separately. `scripts/deploy.mjs` and `scripts/verify-studionet.mjs` are the legacy V1 scripts.

MIT licensed.
