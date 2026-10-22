import { test } from "node:test";
import assert from "node:assert/strict";
import {
  demo,
  minor,
  used,
  reserveDemo,
  successful,
  terminal,
} from "./model.js";
test("exact minor units", () => {
  assert.equal(minor("12.05"), 1205);
  for (const n of ["1e2", "-1", "0", "1.001", "NaN"])
    assert.throws(() => minor(n));
});
test("co-funding cap and release", () => {
  const s = demo();
  reserveDemo(s, 1, "F", 50000, "b");
  assert.equal(used(s, 1), 120000);
  assert.throws(() => reserveDemo(s, 1, "F", 1, "c"));
  s.reservations[0].active = false;
  assert.equal(used(s, 1), 50000);
  assert.throws(() => reserveDemo(s, 1, "F", 1, "b"));
});
test("finality requires successful execution", () => {
  assert.equal(successful({ statusName: "FINALIZED" }), false);
  assert.equal(
    successful({
      statusName: "FINALIZED",
      txExecutionResultName: "FINISHED_WITH_ERROR",
    }),
    false,
  );
  assert.equal(
    successful({
      statusName: "ACCEPTED",
      txExecutionResultName: "FINISHED_WITH_RETURN", resultName: "MAJORITY_AGREE",
    }),
    false,
  );
  assert.ok(
    successful({
      statusName: "FINALIZED",
      txExecutionResultName: "FINISHED_WITH_RETURN", resultName: "MAJORITY_AGREE",
    }),
  );
  assert.ok(terminal({ statusName: "UNDETERMINED" }));
});
test("Studio full receipts require a finalized leader return", () => {
  const receipt = { statusName: "FINALIZED", result_name: "MAJORITY_AGREE", consensus_data: { leader_receipt: [
    { mode: "leader", execution_result: "SUCCESS", result: { status: "return" } },
  ] } };
  assert.equal(successful(receipt), true);
  assert.equal(successful({ ...receipt, statusName: "ACCEPTED" }), false);
  receipt.consensus_data.leader_receipt[0].result.status = "error";
  assert.equal(successful(receipt), false);
  receipt.consensus_data.leader_receipt[0].mode = "validator";
  assert.equal(successful(receipt), false);
});

test("leader return alone cannot override a rejected consensus result", () => {
  const receipt={statusName:"FINALIZED",txExecutionResultName:"FINISHED_WITH_RETURN"};
  assert.equal(successful(receipt),false);
  for(const resultName of ["MAJORITY_DISAGREE","NO_MAJORITY","TIMEOUT","DETERMINISTIC_VIOLATION"])
    assert.equal(successful({...receipt,resultName}),false);
  assert.equal(successful({...receipt,result_name:"MAJORITY_AGREE"}),true);
  assert.equal(successful({...receipt,result:6}),true);
  assert.equal(successful({...receipt,result:7}),false);
});
