import test from "node:test";
import assert from "node:assert/strict";
import { planOrphanSurface } from "./orphan-surface.js";

test("device-acceptance with a unique commit and no pull request must be opened, not forked", () => {
  const plan = planOrphanSurface([
    { name: "main", protected: true },
    { name: "feat/device-acceptance-1600", uniqueCommit: true },
    { name: "docs/roadmap-1900", hasOpenPullRequest: true, uniqueCommit: true },
    { name: "bolt/optimize-capability-grants-sort-15351341805406435722", uniqueCommit: true },
    { name: "release/0.8.0" },
  ]);
  assert.deepEqual(plan.openExisting, ["feat/device-acceptance-1600"]);
  assert.deepEqual(plan.pruneCandidates, ["bolt/optimize-capability-grants-sort-15351341805406435722"]);
  assert.ok(plan.hold.includes("main"));
  assert.ok(plan.hold.includes("release/0.8.0"));
  assert.ok(plan.hold.includes("docs/roadmap-1900"));
  assert.equal(JSON.stringify(plan).includes("eyJ"), false);
});

test("a tracked keep-red branch is not a prune candidate", () => {
  const plan = planOrphanSurface([
    { name: "codex/add-event-stream-manager-module", hasOpenPullRequest: true, uniqueCommit: true },
  ]);
  assert.deepEqual(plan.openExisting, []);
  assert.deepEqual(plan.pruneCandidates, []);
  assert.deepEqual(plan.hold, ["codex/add-event-stream-manager-module"]);
});
