import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAttempts, isTransient } from "./probe-cold-start.mjs";

test("200 first try is ready", () => assert.deepEqual(classifyAttempts([{ status: 200 }]), { classification: "ready", ok: true, attempts: 1, firstOkAttempt: 1 }));
test("503 then 200 is cold_start", () => {
  const r = classifyAttempts([{ status: 503 }, { status: 200 }]);
  assert.equal(r.classification, "cold_start"); assert.equal(r.firstOkAttempt, 2);
});
test("timeout, 502, then 200 is cold_start", () => assert.equal(classifyAttempts([{ error: "timeout" }, { status: 502 }, { status: 200 }]).classification, "cold_start"));
test("all 503/timeouts is down (not ok)", () => {
  const r = classifyAttempts([{ status: 503 }, { error: "timeout" }, { status: 503 }, { status: 503 }]);
  assert.equal(r.classification, "down"); assert.equal(r.ok, false);
});
test("hard 500 is error, never cold_start", () => {
  assert.equal(classifyAttempts([{ status: 500 }]).classification, "error");
  assert.equal(classifyAttempts([{ status: 500 }, { status: 200 }]).classification, "error");
});
test("empty / garbage input fails closed", () => {
  assert.equal(classifyAttempts([]).ok, false);
  assert.equal(classifyAttempts(undefined).classification, "unknown");
  assert.equal(isTransient(null), false);
});
test("200 with error flag is not ready", () => assert.equal(classifyAttempts([{ status: 200, error: "timeout" }]).ok, false));
