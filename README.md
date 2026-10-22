# GrantWeave

Every cost, counted once. GrantWeave is a GenLayer application for small project teams coordinating several funding sources against the same expense ledger.

A registrar registers an expense with invoice facts and a maximum cost. GenLayer compares subsequent expense descriptions to the existing ledger, blocking renamed duplicates and uncertain overlaps. Funders' contributions are then reserved against the single underlying expense cap. Releasing a contribution restores capacity and preserves its history.

## Public deployment

- [Live application](https://chuanqili77.github.io/grantweave-genlayer/)
- [Reusable contract](https://github.com/chuanqili77/grant-overlap-primitive)
- Studio Network: `61999`
- Contract: `0x87cB0341BDd533338e00A9E7F29dDd0396857A27`
- [Network verification evidence](./public/studionet-verification.json)
- Deployment transaction: `0x52695c83f1e9ce7b6db1318ff06ed8a3a218d53d96e10b42292ddb301da9758b`

Switch to live mode and click **Read contract** to inspect the public test ledger without a wallet. This deployment uses a dedicated test registrar; connect your own deployment to manage a separate project.

## Run

```sh
npm ci
npm run dev
```

`npm test` checks amount parsing, reservation accounting, wallet identity, pending transaction recovery, stale-state protection and transaction success classification. `npm run build` emits a static site in `dist/`; serve it over HTTP. The relative base supports GitHub Pages repository paths. The SDK dependency is pinned to GenLayerJS 1.1.8 and targets its Studionet interface; it is not a fee-enabled v2 network client.

## Demo

The initial page uses explicitly illustrative fixtures. Reserve a contribution, try exceeding the remaining capacity, release a reservation and export the ledger. Registering a new expense is disabled in demo because semantic comparison requires real GenLayer consensus. Demo data resets on reload.

## Connect a deployed contract

1. Deploy the included `public/contracts/grant_overlap.py` in GenLayer Studio with project name and three-letter currency constructor arguments. Amounts use two decimal places; choose a matching currency.
2. Switch the app to live mode, enter the deployed address and click **Read contract**. No wallet connection is required for this public read.
3. Register a cost, reserve a contribution and release it. Wallet signatures are required for writes. Connect the registrar wallet to write; other wallets can only read.
4. The page waits for FINALIZED and successful execution, then reads `snapshot()`. A finality status alone never counts as successful execution.
5. If tracking times out after a transaction ID was returned, use **Resume pending transaction**. The network- and contract-specific ID is retained in local storage, including across reloads. A new write is blocked until that transaction is resolved. Never resubmit blindly. If the ID was not saved locally, paste it into **Existing transaction ID** and use **Track transaction**; its recipient must match the loaded contract. A finalized write with an unavailable read-back stays resumable.

Live-mode JSON exports include the network, contract address, mode and export time. Demo exports remain labeled demo. The bundled contract is byte-identical to the standalone primitive source.

## Browser checks

```sh
npx playwright install chromium
npm run build
npm run test:browser
```

The browser suite starts local preview and development servers. It tests the actual production build for reservations, cap rejection, release, JSON download and responsive widths. Live UI scenarios replace only the local test adapter to simulate refused signatures, wrong networks, account changes, RPC failures and refresh recovery. This adapter is confined to the test file and is never shipped in the production bundle. Those simulations are not blockchain transaction evidence.

Use `PLAYWRIGHT_EXECUTABLE_PATH` to select an existing Chromium executable. `APP_URL` and `DEV_URL` can target existing local servers.

## Deployment and publishing

`node scripts/verify-studionet.mjs` runs a resumable seven-step network check using `GRANTWEAVE_PRIVATE_KEY` and the local deployment record. It sends zero-value test transactions and records transaction IDs before tracking. Use a fresh test deployment for this fixture sequence.

`npm run deploy:plan` prints the constructor arguments, chain ID and source hash without creating a wallet or submitting a transaction.

For an operator-selected wallet, set `GRANTWEAVE_PRIVATE_KEY` in the shell environment, optionally set `GRANTWEAVE_PROJECT` and `GRANTWEAVE_CURRENCY`, then run `node scripts/deploy.mjs --send`. The key is never written into source or output. A deployment record retains the transaction ID before waiting; `node scripts/deploy.mjs --resume` tracks that record without signing again. The script targets Studionet 61999 only.

The **Publish Pages** workflow publishes the application through GitHub Actions on each push to `main` or a manual run. It builds and publishes `dist/` without embedding an owner or repository name. A favicon, SVG logo and 512 × 512 PNG logo are included in `public/`.

## Scope

One project and one registrar per deployment. This is capacity bookkeeping, not fund transfer, official grant approval or proof of invoice authenticity. Supplied evidence is not independently fetched from invoice providers. The app cannot see undisclosed or external funding. Semantic errors and disagreements remain possible; uncertainty fails closed. Costs cannot be edited, and partially overlapping costs require clarification before registration.

The public test deployment is bundled as the default live address. Local tests use mocks; public transaction evidence is maintained separately from those tests. Writing to any deployment requires its registrar wallet.

## License

MIT.
