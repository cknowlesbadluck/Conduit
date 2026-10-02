import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyEntropy, summarizeEntropy } from "./entropy.js";

test("keeps default, release, and explicit freeze markers", () => {
  assert.equal(classifyEntropy({ repo: "Conduit", kind: "branch", name: "main" }).disposition, "keep");
  assert.equal(classifyEntropy({ repo: "Conduit", kind: "branch", name: "release/0.8.0" }).disposition, "keep");
  assert.equal(
    classifyEntropy({
      repo: "Conduit",
      kind: "pull",
      name: "counsel/db-tls-verify",
      title: "DB TLS: verify Postgres certificates by default (DO NOT MERGE until Render env is set)",
    }).disposition,
    "keep",
  );
  assert.equal(
    classifyEntropy({
      repo: "Conduit",
      kind: "pull",
      name: "codex/refactor-schema-ddl-into-migration-modules",
      title: "DRAFT KEEP RED: Add explicit ordered database migrations",
      draft: true,
    }).disposition,
    "keep",
  );
});

test("prunes superseded docs hygiene passes", () => {
  const decision = classifyEntropy({
    repo: "Resonance",
    kind: "pull",
    name: "docs/hygiene-2300",
    title: "docs: 23:00 EDT portfolio roadmap in place",
  });
  assert.equal(decision.disposition, "prune");
  assert.match(decision.reason, /docs-only/);
});

test("reviews code and bolt branches instead of auto-pruning", () => {
  assert.equal(
    classifyEntropy({ repo: "Resonance", kind: "branch", name: "feat/deploy-lag-classifier" }).disposition,
    "review",
  );
  assert.equal(
    classifyEntropy({ repo: "Conduit", kind: "branch", name: "bolt/optimize-cursor-same-record" }).disposition,
    "review",
  );
});

test("summarizes a mixed portfolio without dropping unclassified work", () => {
  const counts = summarizeEntropy([
    { repo: "Conduit", kind: "branch", name: "main" },
    { repo: "Conduit", kind: "branch", name: "docs/hygiene-1600" },
    { repo: "QuicksilverV1", kind: "pull", name: "feat/m3-t15-gateway-scaffold", title: "feat: scaffold Mercury gateway worker" },
  ]);
  assert.deepEqual(counts, { keep: 1, review: 1, prune: 1 });
});
