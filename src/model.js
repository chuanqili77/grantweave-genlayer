export const demo = () => ({
  schema: 1,
  project: "Open Workshop · Autumn Build",
  currency: "USD",
  owner: "Demo registrar",
  costs: [
    {
      id: 1,
      description: "One shared workshop microscope",
      evidence: "Illustrative invoice LAB-104 · one microscope · October",
      cap: 120000,
    },
    {
      id: 2,
      description: "Community hall hire for two evenings",
      evidence: "Illustrative invoice HALL-22 · 12–13 November",
      cap: 40000,
    },
  ],
  reservations: [
    {
      id: 1,
      cost_id: 1,
      source: "Community science fund",
      amount: 70000,
      reference: "SCI-001",
      active: true,
    },
  ],
});
export function minor(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw Error("Use a positive amount with at most two decimals");
  const [a, b = ""] = value.split(".");
  const n = Number(a) * 100 + Number(b.padEnd(2, "0"));
  if (!Number.isSafeInteger(n) || n < 1 || n > 1e12)
    throw Error("Amount out of range");
  return n;
}
export const used = (state, id) =>
  state.reservations
    .filter((r) => r.cost_id === id && r.active)
    .reduce((s, r) => s + r.amount, 0);
export function normalizeReceipt(r) {
  if (!r) return r;
  const receipts = r.consensus_data?.leader_receipt;
  const leader = (Array.isArray(receipts) ? receipts : [receipts])
    .filter(Boolean).find((x) => x.mode === "leader");
  const execution = r.txExecutionResultName || r.tx_execution_result_name ||
    (leader?.execution_result === "SUCCESS" && leader?.result?.status === "return"
      ? "FINISHED_WITH_RETURN"
      : leader?.execution_result);
  const results = ["IDLE", "AGREE", "DISAGREE", "TIMEOUT", "DETERMINISTIC_VIOLATION", "NO_MAJORITY", "MAJORITY_AGREE", "MAJORITY_DISAGREE"];
  const resultName = r.resultName || r.result_name || results[r.result];
  return { ...r, resultName, statusName: r.statusName || r.status_name,
    txExecutionResultName: execution };
}
export const successful = (r) => {
  const receipt = normalizeReceipt(r);
  return receipt?.statusName === "FINALIZED" &&
    receipt?.txExecutionResultName === "FINISHED_WITH_RETURN" &&
    ["MAJORITY_AGREE", "AGREE", "SUCCESS"].includes(receipt?.resultName);
};
export const terminal = (r) =>
  ["FINALIZED", "CANCELED", "UNDETERMINED"].includes(r?.statusName);
export function reserveDemo(state, id, source, amount, reference) {
  const c = state.costs.find((c) => c.id === id);
  if (!c) throw Error("Unknown cost");
  if (!source.trim() || !reference.trim())
    throw Error("Source and reference required");
  if (state.reservations.some((r) => r.reference === reference))
    throw Error("Reference already used");
  if (used(state, id) + amount > c.cap)
    throw Error("Expense capacity exceeded");
  state.reservations.push({
    id: state.reservations.length + 1,
    cost_id: id,
    source,
    amount,
    reference,
    active: true,
  });
}

// Check the public state before rendering numbers or enabling writes.
export function validateSnapshot(raw) {
  const s = typeof raw === "string" ? JSON.parse(raw) : raw;
  const integer = (n) => Number.isSafeInteger(n) && n > 0 && n <= 1e12;
  const text = (v, max) => typeof v === "string" && v.trim() && v.length <= max;
  if (
    !s ||
    ![1, 2].includes(s.schema) ||
    !text(s.project, 160) ||
    !/^[A-Z]{3}$/.test(s.currency) ||
    (s.schema === 1 && !/^0x[0-9a-fA-F]{40}$/.test(s.owner)) ||
    !Array.isArray(s.costs) ||
    s.costs.length > 24 ||
    !Array.isArray(s.reservations) ||
    s.reservations.length > 120
  )
    throw Error("Unexpected contract schema");
  if (s.schema === 2) validateV2(s, text, integer);
  s.costs.forEach((c, i) => {
    if (
      c.id !== i + 1 ||
      !text(c.description, 900) ||
      !text(c.evidence, 1800) ||
      !integer(c.cap)
    )
      throw Error("Invalid expense in contract state");
  });
  const references = new Set();
  s.reservations.forEach((r, i) => {
    if (
      r.id !== i + 1 ||
      !Number.isSafeInteger(r.cost_id) ||
      r.cost_id < 1 ||
      r.cost_id > s.costs.length ||
      !integer(r.amount) ||
      typeof r.active !== "boolean" ||
      (s.schema === 1 ? !text(r.source, 160) : !s.funders.includes(r.funder)) ||
      !text(r.reference, 160) ||
      references.has(s.schema === 2 ? `${r.funder}:${r.reference}` : r.reference)
    )
      throw Error("Invalid reservation in contract state");
    references.add(s.schema === 2 ? `${r.funder}:${r.reference}` : r.reference);
  });
  if (s.costs.some((c) => used(s, c.id) > c.cap))
    throw Error("Contract state exceeds an expense cap");
  return s;
}

const address = (v) => typeof v === "string" && /^0x[0-9a-f]{40}$/.test(v) && !/^0x0{40}$/.test(v);
function validateV2(s, text, integer) {
  if (!address(s.project_party) || !Array.isArray(s.funders) ||
      s.funders.length !== 2 || !s.funders.every(address) ||
      new Set([s.project_party, ...s.funders]).size !== 3 ||
      s.required_approvals !== 2 || !Array.isArray(s.proposals) || s.proposals.length > 48)
    throw Error("Invalid V2 participants or approvals");
  s.proposals.forEach((p, i) => {
    if (p.id !== i + 1 || ![s.project_party, ...s.funders].includes(p.proposer) ||
        !text(p.description, 900) || !text(p.evidence, 1800) || !integer(p.cap) ||
        !Array.isArray(p.approvals) || !p.approvals.every(a => s.funders.includes(a)) ||
        new Set(p.approvals).size !== p.approvals.length ||
        !["PENDING", "ACTIVE"].includes(p.status))
      throw Error("Invalid V2 proposal");
    const cost = s.costs.find(c => c.proposal_id === p.id);
    if (p.status === "ACTIVE" ? (!cost || p.cost_id !== cost.id || p.approvals.length !== 2 ||
        cost.description !== p.description || cost.evidence !== p.evidence || cost.cap !== p.cap)
        : (cost || p.cost_id !== undefined))
      throw Error("Invalid V2 proposal activation");
  });
  if (new Set(s.costs.map(c => c.proposal_id)).size !== s.costs.length ||
      s.costs.some(c => s.proposals[c.proposal_id - 1]?.status !== "ACTIVE"))
    throw Error("Invalid V2 cost proposal link");
}
export function walletRole(state, account) {
  const who = account?.toLowerCase();
  if (!who) return "Disconnected";
  if (state.schema === 2) {
    if (who === state.project_party) return "Project party";
    const index = state.funders.indexOf(who);
    return index >= 0 ? `Funder ${index + 1}` : "Read only";
  }
  return who === state.owner?.toLowerCase() ? "Registrar" : "Read only";
}
export function canWrite(state, account, method, args = []) {
  const role = walletRole(state, account);
  if (state.schema !== 2) return role === "Registrar";
  const funder = role.startsWith("Funder ");
  const participant = funder || role === "Project party";
  if (method === "propose_cost") return participant;
  if (method === "reserve") return funder;
  if (method === "release") return funder && state.reservations.some(r => r.id === args[0] && r.active && r.funder === account.toLowerCase());
  const proposal = state.proposals.find(p => p.id === args[0]);
  if (!proposal || proposal.status !== "PENDING") return false;
  if (method === "approve_cost") return funder && !proposal.approvals.includes(account.toLowerCase());
  if (method === "activate_cost") return participant && proposal.approvals.length === 2;
  return false;
}
