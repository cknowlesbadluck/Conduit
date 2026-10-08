import test from "node:test";
import assert from "node:assert/strict";
import { decidePhaseLock, disposePull, KEEP_RED, type OpenPull } from "./phase-lock.js";

const pulls: OpenPull[] = [
  { repo: "Conduit", number: 187, title: "feat: portfolio cutover lattice" },
  { repo: "Conduit", number: 185, title: "feat: entropy governor for witness budget and keep-red" },
  { repo: "Conduit", number: 183, title: "feat: project-agnostic work admission gate" },
  { repo: "Conduit", number: 182, title: "feat: project-agnostic degrade planner" },
  { repo: "Conduit", number: 180, title: "feat: project-agnostic phase clock" },
  { repo: "Conduit", number: 162, title: "harden: shared Postgres TLS policy and optional HMAC cursors" },
  { repo: "Conduit", number: 155, title: "DB TLS: verify Postgres certificates by default (DO NOT MERGE until Render env is set)" },
  { repo: "Conduit", number: 120, title: "older keep-red" },
  { repo: "Conduit", number: 119, title: "older keep-red" },
  { repo: "QuicksilverV1", number: 241, title: "feat: refuse device acceptance on gateway health" },
  { repo: "QuicksilverV1", number: 209, title: "chore(deps): bump actions/checkout from 4 to 7 in the actions group" },
];

test("never merges keep-red and never opens a new witness while lattice is open", () => {
  const decision = decidePhaseLock({ latticeOpen: true, pulls });
  assert.equal(decision.openNewWitness, false);
  assert.equal(decision.revision, "2026-10-08-phase-lock");
  for (const number of KEEP_RED) {
    assert.equal(disposePull({ repo: "Conduit", number, title: "keep" }, true), "keep_red");
  }
  assert.deepEqual(decision.closeNumbers.sort((a, b) => a - b), [180, 182, 183, 185]);
  assert.ok(decision.holdNumbers.includes(241));
  assert.ok(decision.holdNumbers.includes(209));
  assert.ok(!decision.closeNumbers.includes(187));
  assert.ok(!decision.closeNumbers.includes(241));
});

test("does not close older families when no lattice pull request is open", () => {
  assert.equal(disposePull({ repo: "Conduit", number: 185, title: "feat: entropy governor" }, false), "hold");
});
