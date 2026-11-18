// Replays paid answers recorded by scripts/live-check.mjs through the pay-or-hold rule.
// Listed names must hold; invented names must pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { judge, decide } from "../src/screen.mjs";

const rows = JSON.parse(readFileSync(new URL("./fixtures/live-names.json", import.meta.url)));

test("recorded paid answers: every listed name and wallet holds, every clean one passes", () => {
  let listed = 0, clean = 0;
  for (const { name, kind, expect, checks } of rows) {
    const verdicts = checks.map((c) =>
      judge(c.miner, name, c.status, { miner_id: c.answeredBy, input: { name: c.echoed }, result: c.result, field_status: c.fieldStatus }, c.receipt));
    assert.equal(verdicts.length, kind === "wallet" ? 1 : 2, name);
    if (expect === true) { assert.notEqual(decide(verdicts), "screened", name); listed++; }
    if (expect === false) { assert.equal(decide(verdicts), "screened", name); clean++; }
  }
  assert.deepEqual([listed, clean], [12, 12]); // 10 names and 2 wallets each
});

test("anything that is not an explicit valid no-match holds", () => {
  const ok = { miner_id: "731002", input: { name: "A" }, result: { matched: false, match_score: 0 }, field_status: { matched: "ok" } };
  const paid = { receipt_hash: "0x" + "ab".repeat(32) };
  assert.equal(judge("731002", "A", 200, ok, paid), "clean");
  for (const none of [undefined, null, {}, true, { success: false }, { receipt_hash: "0x12" }])
    assert.equal(judge("731002", "A", 200, ok, none), "unresolved"); // no receipt, no pass
  assert.equal(judge("731002", "A", 500, ok, paid), "unresolved"); // error status
  assert.equal(judge("731002", "A", 200, { ...ok, miner_id: "302" }, paid), "unresolved"); // another miner answered
  assert.equal(judge("731002", "B", 200, ok, paid), "unresolved"); // answered a different question
  assert.equal(judge("731002", "A", 200, { ...ok, result: { matched: null, match_score: 1 }, field_status: { matched: "unavailable" } }, paid), "match");
  assert.equal(judge("731002", "A", 200, { ...ok, result: { matched: null }, field_status: { matched: "missing" } }, paid), "unresolved");
  assert.equal(judge("731002", "A", 200, { ...ok, result: { matched: false, match_score: 0.4 } }, paid), "clean"); // some similarity, and the miner says no match
  assert.equal(judge("731002", "A", 200, { ...ok, result: { matched: false, match_score: 0.73 } }, paid), "match"); // too close to a listed name to pass
  assert.equal(decide(["clean", "clean", "unresolved"]), "held_unresolved");
  assert.equal(decide(["clean", "match", "clean"]), "held_match");
});
