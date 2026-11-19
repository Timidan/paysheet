// Replays paid answers recorded by scripts/live-check.mjs through the pay-or-hold rule.
// Listed names must hold; invented names must pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { judge, decide } from "../src/screen.mjs";

const rows = JSON.parse(readFileSync(new URL("./fixtures/live-names.json", import.meta.url)));

test("recorded paid answers: every listed name holds, every invented name passes", () => {
  let listed = 0, clean = 0;
  for (const { name, expect, checks } of rows) {
    const verdicts = checks.map((c) =>
      judge(c.miner, name, c.status, { miner_id: c.answeredBy, input: { name: c.echoed }, result: c.result, field_status: c.fieldStatus }));
    assert.equal(verdicts.length, 2, name);
    if (expect === true) { assert.notEqual(decide(verdicts), "screened", name); listed++; }
    if (expect === false) { assert.equal(decide(verdicts), "screened", name); clean++; }
  }
  assert.deepEqual([listed, clean], [10, 10]);
});

test("anything that is not an explicit valid no-match holds", () => {
  const ok = { miner_id: "731002", input: { name: "A" }, result: { matched: false, match_score: 0 }, field_status: { matched: "ok" } };
  assert.equal(judge("731002", "A", 200, ok), "clean");
  assert.equal(judge("731002", "A", 500, ok), "unresolved"); // error status
  assert.equal(judge("731002", "A", 200, { ...ok, miner_id: "302" }), "unresolved"); // another miner answered
  assert.equal(judge("731002", "B", 200, ok), "unresolved"); // answered a different question
  assert.equal(judge("731002", "A", 200, { ...ok, result: { matched: null, match_score: 1 }, field_status: { matched: "unavailable" } }), "match");
  assert.equal(judge("731002", "A", 200, { ...ok, result: { matched: null }, field_status: { matched: "missing" } }), "unresolved");
  assert.equal(decide(["clean", "clean", "unresolved"]), "held_unresolved");
  assert.equal(decide(["clean", "match", "clean"]), "held_match");
});

test("praman desk miner 5281 answers evaluate correctly through judge", () => {
  const pramanOk = { miner_id: "5281", input: { name: "Safe Contractor LLC" }, result: { matched: false, match_score: 0 }, field_status: { matched: "ok" } };
  assert.equal(judge("5281", "Safe Contractor LLC", 200, pramanOk), "clean");

  const pramanMatch = { miner_id: "5281", input: { name: "Lazarus Group" }, result: { matched: true, match_score: 1.0 }, field_status: { matched: "ok" } };
  assert.equal(judge("5281", "Lazarus Group", 200, pramanMatch), "match");

  // 3-way consensus with Praman Desk
  assert.equal(decide(["clean", "clean", "clean"]), "screened");
  assert.equal(decide(["clean", "clean", "match"]), "held_match");
});
