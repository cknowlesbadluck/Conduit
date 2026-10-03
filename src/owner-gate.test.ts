import test from "node:test";
import assert from "node:assert/strict";
import { classifyCoordinationTask, partitionCoordinationTasks } from "./owner-gate.js";

test("GATE titles are owner-blocked and not agent work", () => {
  assert.equal(
    classifyCoordinationTask({ title: "GATE: owner set SUPABASE_SERVICE_ROLE_KEY on resonancenexus" }),
    "owner-blocked",
  );
  assert.equal(
    classifyCoordinationTask({ title: "GATE: Quicksilver device HG on iPhone 16e" }),
    "owner-blocked",
  );
});

test("AUDIT snapshots are noise even when still open", () => {
  assert.equal(
    classifyCoordinationTask({ title: "AUDIT: portfolio 21:00 EDT 2026-10-02 proof promotion", status: "open" }),
    "audit-noise",
  );
});

test("frozen draft language outranks a normal title", () => {
  assert.equal(
    classifyCoordinationTask({
      title: "Add explicit ordered database migrations",
      description: "DRAFT KEEP RED until the migration runner is proven.",
    }),
    "frozen",
  );
  assert.equal(
    classifyCoordinationTask({ title: "DB TLS: verify Postgres certificates (DO NOT MERGE until Render env is set)" }),
    "frozen",
  );
});

test("ordinary implementation tasks stay executable", () => {
  const partitioned = partitionCoordinationTasks([
    { title: "GATE: device HG" },
    { title: "AUDIT: snapshot" },
    { title: "Wire gateway decoder fixtures", description: "DO NOT MERGE" },
    { title: "Add owner-gate classifier" },
  ]);
  assert.equal(partitioned.ownerBlockedCount, 1);
  assert.equal(partitioned.agentWorkCount, 1);
  assert.equal(partitioned.frozen.length, 1);
  assert.equal(partitioned["audit-noise"].length, 1);
  assert.equal(partitioned["agent-executable"][0]?.title, "Add owner-gate classifier");
});
