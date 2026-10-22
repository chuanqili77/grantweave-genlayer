// Dry run by default. Sending is an explicit CLI operation with an operator-selected wallet.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { successful, normalizeReceipt } from "../src/model.js";
const source = await readFile(
  new URL("../public/contracts/grant_overlap.py", import.meta.url),
  "utf8",
);
const project = process.env.GRANTWEAVE_PROJECT || "Community Workshop";
const currency = process.env.GRANTWEAVE_CURRENCY || "USD";
if (!project.trim() || project.length > 160)
  throw Error("Project name must be 1–160 characters");
if (
  !["USD", "EUR", "GBP", "CNY", "SGD", "AUD", "CAD", "HKD", "CHF"].includes(
    currency,
  )
)
  throw Error("Unsupported two-decimal currency");
const plan = {
  chainId: studionet.id,
  network: "studionet",
  project,
  currency,
  sourceSha256: createHash("sha256").update(source).digest("hex"),
  constructorArgs: [project, currency],
};
const send = process.argv.includes("--send"),
  resume = process.argv.includes("--resume");
if (send && resume) throw Error("Choose --send or --resume");
if (!send && !resume) {
  console.log(JSON.stringify({ mode: "dry-run", ...plan }, null, 2));
} else {
  const path = "deployments/studionet.json";
  let record, client;
  if (resume) {
    record = JSON.parse(await readFile(path, "utf8"));
    if (
      record.chainId !== studionet.id ||
      !/^0x[0-9a-fA-F]{64}$/.test(record.transactionHash || "")
    )
      throw Error("Invalid deployment record");
    client = createClient({ chain: studionet });
  } else {
    const key = process.env.GRANTWEAVE_PRIVATE_KEY;
    if (!/^0x[0-9a-fA-F]{64}$/.test(key || ""))
      throw Error(
        "Set an operator-selected GRANTWEAVE_PRIVATE_KEY before --send. No wallet is auto-generated.",
      );
    const account = createAccount(key);
    client = createClient({ chain: studionet, account });
    await mkdir("deployments", { recursive: true });
    try {
      await readFile(path);
      throw Error(
        "Deployment record already exists. Run --resume instead of redeploying.",
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const hash = await client.deployContract({
      code: source,
      args: plan.constructorArgs,
    });
    record = {
      ...plan,
      registrar: account.address,
      transactionHash: hash,
      status: "submitted",
    };
    await writeFile(path, JSON.stringify(record, null, 2) + "\n", {
      flag: "wx",
    });
    console.log(`Deployment submitted: ${hash}. Record: ${path}`);
  }
  const receipt = normalizeReceipt(await client.waitForTransactionReceipt({
    hash: record.transactionHash,
    status: "FINALIZED",
    interval: 5000,
    retries: 60,
    fullTransaction: true,
  }));
  record.status = receipt.statusName;
  record.execution = receipt.txExecutionResultName;
  record.contractAddress = receipt.txDataDecoded?.contractAddress || receipt.data?.contract_address || null;
  await writeFile(path, JSON.stringify(record, null, 2) + "\n");
  if (!successful(receipt))
    throw Error(
      "Deployment did not finish successfully. Inspect the recorded transaction; do not submit again.",
    );
  if (!record.contractAddress)
    throw Error(
      "Deployment finalized successfully. Resolve its contract address from the recorded transaction before using the app.",
    );
  const state = JSON.parse(
    await client.readContract({
      address: record.contractAddress,
      functionName: "snapshot",
      args: [],
      transactionHashVariant: "latest-final",
    }),
  );
  if (
    state.project !== record.project ||
    state.owner.toLowerCase() !== record.registrar.toLowerCase()
  )
    throw Error(
      "Deployment state does not match the intended project/registrar",
    );
  console.log(`Contract verified by read-back: ${record.contractAddress}`);
}
