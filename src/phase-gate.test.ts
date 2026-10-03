import assert from "node:assert/strict";
import test from "node:test";
import { planPhases, type PhaseSpec, type ProbeFact } from "./phase-gate.js";

const phases: PhaseSpec[] = [
  {
    id: "p1-owner",
    title: "owner secret",
    ownerOnly: true,
    met: (probes) => {
      const host = probes.find((probe) => probe.service === "control");
      return host?.httpStatus === 200 && (host.missingRequired?.length ?? 0) === 0;
    },
  },
  {
    id: "p2-stamp",
    title: "contract stamp on the public host",
    ownerOnly: false,
    dependsOn: ["p1-owner"],
    met: (probes) => {
      const host = probes.find((probe) => probe.service === "control");
      return typeof host?.contractRevision === "string" && host.contractRevision.length > 0;
    },
  },
  {
    id: "p3-bridge",
    title: "bridge health parity",
    ownerOnly: false,
    met: (probes) => {
      const bridge = probes.find((probe) => probe.service === "bridge");
      return bridge?.httpStatus === 200 && bridge.version === "0.8.0" && typeof bridge.contractRevision === "string";
    },
  },
];

test("owner gate stays next even when a later exit is already true", () => {
  const probes: ProbeFact[] = [
    {
      service: "control",
      httpStatus: 503,
      missingRequired: ["SERVICE_ROLE"],
      contractRevision: null,
      ownerActionRequired: null,
    },
    {
      service: "bridge",
      httpStatus: 200,
      version: "0.8.0",
      contractRevision: "2026-10-03-ready-surface",
      persistence: "postgres",
    },
  ];
  const plan = planPhases(phases, probes);
  assert.equal(plan.next, "p1-owner");
  assert.equal(plan.nextOwnerOnly, true);
  assert.deepEqual(plan.satisfiedAhead, ["p3-bridge"]);
  assert.deepEqual(plan.open, ["p1-owner", "p2-stamp"]);
  assert.equal(plan.bindingConstraint, "p1-owner is owner-only");
});

test("a missing stamp is not counted as deploy proof", () => {
  const probes: ProbeFact[] = [
    { service: "control", httpStatus: 200, missingRequired: [], contractRevision: null },
    { service: "bridge", httpStatus: 200, version: "0.8.0", contractRevision: "stamp" },
  ];
  const plan = planPhases(phases, probes);
  assert.equal(plan.next, "p2-stamp");
  assert.equal(plan.nextOwnerOnly, false);
  assert.deepEqual(plan.met, ["p1-owner", "p3-bridge"]);
});

test("all exits met yields no next phase", () => {
  const probes: ProbeFact[] = [
    { service: "control", httpStatus: 200, missingRequired: [], contractRevision: "stamp" },
    { service: "bridge", httpStatus: 200, version: "0.8.0", contractRevision: "stamp" },
  ];
  const plan = planPhases(phases, probes);
  assert.equal(plan.next, null);
  assert.deepEqual(plan.open, []);
  assert.deepEqual(plan.satisfiedAhead, []);
});

test("does not treat a 200 without version as bridge parity", () => {
  const probes: ProbeFact[] = [
    { service: "control", httpStatus: 503, missingRequired: ["SERVICE_ROLE"] },
    { service: "bridge", httpStatus: 200, version: null, contractRevision: null },
  ];
  const plan = planPhases(phases, probes);
  assert.equal(plan.satisfiedAhead.includes("p3-bridge"), false);
  assert.equal(plan.open.includes("p3-bridge"), true);
});
