import test from "node:test";
import assert from "node:assert/strict";
import { admitWork, bindingConstraint, classifyProbe } from "./entropy-governor.js";

const liveReady = {
  status: "not_ready",
  service: "resonance-nexus",
  stage: "deployment",
  production: true,
  authMode: "required",
  authModeOk: true,
  persistenceConfigured: false,
  githubAdapterConfigured: false,
  missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"],
};

test("live 2026-10-08 probes classify without inventing a secret", () => {
  assert.equal(
    classifyProbe("conduit_health", 200, {
      status: "ok",
      service: "conduit",
      version: "0.8.0",
      contractRevision: "2026-10-03-ready-surface",
    }),
    "conduit_ready",
  );
  assert.equal(
    classifyProbe("conduit_ready", 200, {
      status: "ready",
      service: "conduit",
      version: "0.8.0",
      contractRevision: "2026-10-03-ready-surface",
      persistence: "postgres",
    }),
    "conduit_ready",
  );
  assert.equal(classifyProbe("resonance_ready", 503, liveReady), "resonance_owner_gate");
  assert.equal(
    classifyProbe("vercel_alias", 404, { vercelError: "DEPLOYMENT_NOT_FOUND" }),
    "alias_absent",
  );
});

test("a ready body that grows ownerActionRequired or contractRevision is a leak", () => {
  assert.equal(
    classifyProbe("resonance_ready", 503, { ...liveReady, ownerActionRequired: true }),
    "contract_leak",
  );
  assert.equal(
    classifyProbe("resonance_ready", 503, { ...liveReady, contractRevision: "2026-10-03-ready-surface" }),
    "contract_leak",
  );
});

test("witness budget blocks another status PR and keep-red stays closed", () => {
  assert.deepEqual(admitWork({ kind: "witness", openWitnessPulls: 2 }), {
    admit: false,
    reason: "witness_budget_spent",
  });
  assert.deepEqual(admitWork({ kind: "implementation", openWitnessPulls: 2 }), {
    admit: true,
    reason: "implementation_allowed",
  });
  assert.deepEqual(admitWork({ kind: "owner", openWitnessPulls: 0 }), {
    admit: false,
    reason: "owner_action_is_not_an_agent_pr",
  });
  assert.equal(admitWork({ kind: "implementation", openWitnessPulls: 0, pullNumber: 155 }).admit, false);
  assert.equal(admitWork({ kind: "implementation", openWitnessPulls: 0, pullNumber: 119 }).reason, "keep_red_refused");
});

test("binding constraint is the owner secret, not the absent alias", () => {
  assert.equal(
    bindingConstraint(["conduit_ready", "resonance_owner_gate", "alias_absent"]),
    "owner_secret",
  );
});
