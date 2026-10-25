import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, parseSummary } from "./test-summary-gate.mjs";

const tap = (o) => ["TAP version 13", "ok 1 - x", ...Object.entries(o).map(([k, v]) => `# ${k} ${v}`)].join("\n");

test("clean run passes", () => {
  assert.equal(evaluate(tap({ tests: 5, pass: 5, fail: 0, cancelled: 0, skipped: 0 })).ok, true);
});
test("cancelled > 0 fails even when fail is 0", () => {
  const r = evaluate(tap({ tests: 5, pass: 3, fail: 0, cancelled: 2 }));
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(), /cancelled=2/);
});
test("fail > 0 fails", () => assert.equal(evaluate(tap({ tests: 2, pass: 1, fail: 1, cancelled: 0 })).ok, false));
test("missing summary fails closed", () => assert.equal(evaluate("TAP version 13\nok 1 - x").ok, false));
test("zero tests fails closed", () => assert.equal(evaluate(tap({ tests: 0, pass: 0, fail: 0, cancelled: 0 })).ok, false));
test("missing cancelled line fails closed", () => assert.equal(evaluate(tap({ tests: 1, pass: 1, fail: 0 })).ok, false));
test("last summary wins (nested subtest counters ignored)", () => {
  const t = "# tests 1\n# cancelled 0\n" + tap({ tests: 4, pass: 4, fail: 0, cancelled: 1 });
  assert.equal(parseSummary(t).cancelled, 1);
});
test("indented subtest lines are not top-level summary", () => {
  assert.equal(parseSummary("    # cancelled 3\n# tests 1\n# cancelled 0").cancelled, 0);
});
test("spec reporter summary (ℹ) is parsed too", () => {
  assert.equal(evaluate("ℹ tests 3\nℹ pass 3\nℹ fail 0\nℹ cancelled 1").ok, false);
});
