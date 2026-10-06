import test from "node:test";
import assert from "node:assert/strict";
import { admitChange, classifyOpenWork, invariantKey } from "./entropy-gate.js";

test("invariant key ignores conventional prefixes and punctuation", () => {
  assert.equal(invariantKey("feat: degrade planner for host probes"), "degrade-planner-host-probes");
  assert.equal(invariantKey("⚡ Bolt: avoid temporary array allocation"), "avoid-temporary-array-allocation");
});

test("keep-red and do-not-merge records are never classified close", () => {
  const keep = classifyOpenWork({ id: "119", title: "DRAFT KEEP RED: Add explicit ordered database migrations", behind: 40 });
  const blocked = classifyOpenWork({ id: "155", title: "DB TLS: verify Postgres certificates by default (DO NOT MERGE until Render env is set)" });
  assert.equal(keep.disposition, "keep");
  assert.equal(blocked.disposition, "keep");
});

test("secret-blocked work is not mergeable and is not auto-closed", () => {
  const item = classifyOpenWork({ id: "150", title: "pin public ready body", secretBlocked: true, behind: 12 });
  assert.equal(item.disposition, "secret_blocked");
});

test("bolt micro-opts are prune candidates", () => {
  const item = classifyOpenWork({ id: "181", title: "⚡ Bolt: avoid temporary array allocation in event publisher" });
  assert.equal(item.disposition, "close");
});

test("stale diverged work is closed; mildly behind work is rebase", () => {
  const stale = classifyOpenWork({ id: "134", title: "iOS app target", baseSha: "old", behind: 7 }, "new");
  const rebase = classifyOpenWork({ id: "209", title: "bump checkout", baseSha: "old", behind: 2 }, "new");
  assert.equal(stale.disposition, "close");
  assert.equal(rebase.disposition, "rebase");
});

test("admission rejects a duplicate invariant and reports prune set", () => {
  const decision = admitChange(
    { title: "feat: degrade planner for host probes" },
    [
      { id: "151", title: "feat: degrade planner for host probes" },
      { id: "181", title: "⚡ Bolt: avoid temporary array allocation" },
      { id: "119", title: "DRAFT KEEP RED: migrations" },
    ],
  );
  assert.equal(decision.admit, false);
  assert.deepEqual(decision.collidingIds, ["151"]);
  assert.equal(decision.prune.find((item) => item.id === "181")?.disposition, "close");
  assert.equal(decision.prune.find((item) => item.id === "119")?.disposition, "keep");
});

test("admission allows a new invariant under the ceiling and blocks at the ceiling", () => {
  const open = Array.from({ length: 8 }, (_, index) => ({ id: String(index), title: `active slice ${index} work` }));
  const blocked = admitChange({ title: "feat: fresh capability probe" }, open, { openCeiling: 8 });
  assert.equal(blocked.admit, false);
  const allowed = admitChange({ title: "feat: fresh capability probe" }, open.slice(0, 2), { openCeiling: 8 });
  assert.equal(allowed.admit, true);
  assert.equal(JSON.stringify(allowed).includes("DATABASE_URL"), false);
});
