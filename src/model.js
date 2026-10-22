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
  return { ...r, statusName: r.statusName || r.status_name,
    txExecutionResultName: execution };
}
export const successful = (r) => {
  const receipt = normalizeReceipt(r);
  return receipt?.statusName === "FINALIZED" &&
    receipt?.txExecutionResultName === "FINISHED_WITH_RETURN";
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
    s.schema !== 1 ||
    !text(s.project, 160) ||
    !/^[A-Z]{3}$/.test(s.currency) ||
    !/^0x[0-9a-fA-F]{40}$/.test(s.owner) ||
    !Array.isArray(s.costs) ||
    s.costs.length > 24 ||
    !Array.isArray(s.reservations) ||
    s.reservations.length > 120
  )
    throw Error("Unexpected contract schema");
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
      !text(r.source, 160) ||
      !text(r.reference, 160) ||
      references.has(r.reference)
    )
      throw Error("Invalid reservation in contract state");
    references.add(r.reference);
  });
  if (s.costs.some((c) => used(s, c.id) > c.cap))
    throw Error("Contract state exceeds an expense cap");
  return s;
}
