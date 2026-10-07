import assert from "node:assert/strict";
import test from "node:test";
import { collapseStacks } from "./stack-collapse.js";

const live = {
  coordination: "ready" as const,
  product: "owner_blocked" as const,
  alias: "alias_absent" as const,
  keepRedNumbers: [119, 120, 155, 162],
  records: [
    { repo: "Conduit", number: 183, title: "feat: project-agnostic work admission gate", theme: "coordination", requiredChecksRed: true, openedAt: "2026-10-07T13:07:44Z" },
    { repo: "Conduit", number: 182, title: "feat: project-agnostic degrade planner", theme: "coordination", openedAt: "2026-10-06T19:27:49Z" },
    { repo: "Conduit", number: 180, title: "feat: project-agnostic phase clock", theme: "coordination", openedAt: "2026-10-06T07:27:14Z" },
    { repo: "Conduit", number: 162, title: "harden: shared Postgres TLS policy", theme: "tls", keepRed: true, openedAt: "2026-10-01T10:11:51Z" },
    { repo: "Conduit", number: 155, title: "DB TLS: verify Postgres certificates by default (DO NOT MERGE until Render env is set)", theme: "tls", openedAt: "2026-09-29T21:03:31Z" },
    { repo: "Conduit", number: 120, title: "DRAFT KEEP RED: Add explicit ordered database migrations", theme: "migrations", draft: true, openedAt: "2026-10-04T08:02:51Z" },
    { repo: "Resonance", number: 152, title: "docs: refresh 10-phase portfolio roadmap", theme: "roadmap", openedAt: "2026-10-07T13:18:26Z" },
    { repo: "Resonance", number: 151, title: "feat: degrade planner for host probes", theme: "product", openedAt: "2026-10-06T19:13:05Z" },
    { repo: "Resonance", number: 150, title: "feat: pin public ready body", theme: "ready-pin", requiredChecksRed: true, openedAt: "2026-10-06T07:17:27Z" },
    { repo: "QuicksilverV1", number: 239, title: "docs: refresh 10-phase portfolio roadmap", theme: "roadmap", openedAt: "2026-10-07T13:23:55Z" },
    { repo: "QuicksilverV1", number: 238, title: "feat: degrade planner for host probes", theme: "client", openedAt: "2026-10-06T19:24:02Z" },
  ],
};

test("owner-blocked portfolio refreshes newest per theme and merges nothing", () => {
  const decision = collapseStacks(live);
  assert.equal(decision.action, "refresh_in_place");
  assert.equal(decision.openNewPullRequest, false);
  assert.deepEqual(decision.mergeNumbers, []);
  assert.deepEqual(decision.refreshNumbers, [150, 151, 152, 183, 238, 239]);
  assert.deepEqual(decision.supersedeNumbers, [180, 182]);
  assert.deepEqual(decision.blockedByRedChecks, [150, 183]);
  assert.deepEqual(decision.holdNumbers.sort((a, b) => a - b), [120, 155, 162]);
  assert.match(decision.reason, /invent no secret/);
});

test("a red required check is never a merge candidate", () => {
  const decision = collapseStacks({
    coordination: "ready",
    product: "ready",
    alias: "ready",
    records: [
      { repo: "Resonance", number: 150, title: "pin", theme: "ready-pin", requiredChecksRed: true, openedAt: "2026-10-06T07:17:27Z" },
    ],
  });
  assert.deepEqual(decision.mergeNumbers, []);
  assert.equal(decision.openNewPullRequest, false);
  assert.deepEqual(decision.blockedByRedChecks, [150]);
  assert.deepEqual(decision.refreshNumbers, [150]);
  assert.equal(decision.action, "hold");
});
