import test from "node:test";
import assert from "node:assert/strict";
import { governSaturation } from "./saturation-governor.js";

const coordination = {
  httpStatus: 200,
  body: {
    status: "ready",
    service: "conduit",
    version: "0.8.0",
    contractRevision: "2026-10-03-ready-surface",
    persistence: "postgres",
  },
};

const product = {
  httpStatus: 503,
  body: {
    status: "not_ready",
    service: "resonance-nexus",
    missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"],
    authMode: "required",
    authModeOk: true,
  },
};

const alias = {
  httpStatus: 404,
  body: "The deployment could not be found on Vercel. DEPLOYMENT_NOT_FOUND",
};

test("05:00 EDT probe closes bolt noise and does not open a pull request", () => {
  const decision = governSaturation({
    coordination,
    product,
    alias,
    roadmapAlreadyOpen: true,
    probedAt: "2026-10-07T09:01:56Z",
    keepRedNumbers: [119, 120, 155, 162],
    openRecords: [
      { number: 184, title: "⚡ Bolt: optimize listCapabilityGrants in-memory sorting" },
      { number: 183, title: "feat: project-agnostic work admission gate" },
      { number: 162, title: "harden: shared Postgres TLS policy" },
      { number: 155, title: "DB TLS: verify Postgres certificates (DO NOT MERGE until Render env is set)" },
      { number: 120, title: "DRAFT KEEP RED: Add explicit ordered database migrations", draft: true },
      { number: 119, title: "DRAFT KEEP RED: Add managed SSE admission", draft: true },
    ],
  });
  assert.equal(decision.mutation, "close_noise");
  assert.equal(decision.openNewPullRequest, false);
  assert.deepEqual(decision.closeNumbers, [184]);
  assert.deepEqual(decision.holdNumbers.sort((a, b) => a - b), [119, 120, 155, 162]);
  assert.equal(decision.phases[0].state, "blocked");
  assert.equal(decision.phases[2].state, "done");
  assert.equal(decision.phases[4].state, "done");
  assert.equal(JSON.stringify(decision).includes("eyJ"), false);
  assert.equal(JSON.stringify(decision).includes("SUPABASE_SERVICE_ROLE_KEY="), false);
});

test("a keep-red bolt title is held, not closed", () => {
  const decision = governSaturation({
    product,
    roadmapAlreadyOpen: true,
    openRecords: [{ number: 7, title: "DRAFT KEEP RED: Bolt experiment", draft: true }],
  });
  assert.deepEqual(decision.closeNumbers, []);
  assert.deepEqual(decision.holdNumbers, [7]);
});

test("alias absence is not an owner gate", () => {
  const decision = governSaturation({ alias, openRecords: [], roadmapAlreadyOpen: false });
  assert.equal(decision.phases[4].state, "done");
  assert.equal(decision.phases[0].state, "open");
  assert.equal(decision.openNewPullRequest, false);
});

test("owner block without a roadmap still admits nothing", () => {
  const decision = governSaturation({ product, openRecords: [], roadmapAlreadyOpen: false });
  assert.equal(decision.mutation, "owner_only");
  assert.equal(decision.openNewPullRequest, false);
});

test("phase 10 stays blocked until the product host is ready", () => {
  const decision = governSaturation({ coordination, product, roadmapAlreadyOpen: true, openRecords: [] });
  assert.equal(decision.phases[9].state, "blocked");
});
