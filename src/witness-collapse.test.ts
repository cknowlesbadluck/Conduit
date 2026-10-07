import test from "node:test";
import assert from "node:assert/strict";
import { collapseWitnesses } from "./witness-collapse.js";

const liveCoordination = {
  httpStatus: 200,
  body: {
    status: "ready",
    service: "conduit",
    version: "0.8.0",
    contractRevision: "2026-10-03-ready-surface",
    persistence: "postgres",
  },
};

const liveProduct = {
  httpStatus: 503,
  body: {
    status: "not_ready",
    missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"],
    authMode: "required",
    authModeOk: true,
  },
};

const liveAlias = {
  httpStatus: 404,
  body: "The deployment could not be found on Vercel. DEPLOYMENT_NOT_FOUND",
};

test("02:00 EDT probe refreshes in place and does not open a pull request", () => {
  const decision = collapseWitnesses({
    coordination: liveCoordination,
    product: liveProduct,
    alias: liveAlias,
    roadmapAlreadyOpen: true,
    keepRedNumbers: [119, 120, 155, 162],
    openRecords: [
      { number: 183, title: "feat: project-agnostic work admission gate" },
      { number: 162, title: "harden: shared Postgres TLS policy" },
      { number: 155, title: "DB TLS: verify Postgres certificates (DO NOT MERGE until Render env is set)" },
      { number: 120, title: "DRAFT KEEP RED: Add explicit ordered database migrations", draft: true },
      { number: 119, title: "DRAFT KEEP RED: Add managed SSE admission", draft: true },
    ],
  });
  assert.equal(decision.action, "refresh_in_place");
  assert.equal(decision.openNewPullRequest, false);
  assert.deepEqual(decision.holdNumbers.sort((a, b) => a - b), [119, 120, 155, 162]);
  assert.equal(decision.phases[0].state, "blocked");
  assert.equal(decision.phases[2].state, "done");
  assert.equal(decision.phases[4].state, "done");
  assert.equal(JSON.stringify(decision).includes("eyJ"), false);
});

test("alias absence alone is not an owner gate and is not a new deploy", () => {
  const decision = collapseWitnesses({
    alias: liveAlias,
    openRecords: [],
    roadmapAlreadyOpen: false,
  });
  assert.equal(decision.action, "alias_absent");
  assert.equal(decision.openNewPullRequest, false);
  assert.equal(decision.phases[4].state, "done");
});

test("keep-red titles stay held even without an explicit number list", () => {
  const decision = collapseWitnesses({
    coordination: liveCoordination,
    openRecords: [{ number: 9, title: "DRAFT KEEP RED: migrations" }],
  });
  assert.equal(decision.action, "keep_red");
  assert.deepEqual(decision.holdNumbers, [9]);
  assert.deepEqual(decision.mergeCandidates, []);
});

test("a clear product host with no roadmap record may admit one new record", () => {
  const decision = collapseWitnesses({
    coordination: liveCoordination,
    product: { httpStatus: 200, body: { status: "ready", ownerActionRequired: false } },
    openRecords: [],
    roadmapAlreadyOpen: false,
  });
  assert.equal(decision.action, "admit_new");
  assert.equal(decision.openNewPullRequest, true);
  assert.equal(decision.phases[0].state, "done");
});

test("owner block without a roadmap record still refuses a product pull request", () => {
  const decision = collapseWitnesses({
    product: liveProduct,
    openRecords: [],
    roadmapAlreadyOpen: false,
  });
  assert.equal(decision.action, "owner_blocked");
  assert.equal(decision.openNewPullRequest, false);
});
