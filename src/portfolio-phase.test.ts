import test from "node:test";
import assert from "node:assert/strict";
import { PORTFOLIO_PHASES, classifyPortfolio, classifyPortfolioPhase } from "./portfolio-phase.js";

test("phase catalog is ten gates and never embeds a product name", () => {
  assert.equal(PORTFOLIO_PHASES.length, 10);
  assert.equal(PORTFOLIO_PHASES[0].id, 0);
  assert.equal(PORTFOLIO_PHASES[9].id, 9);
  assert.equal(JSON.stringify(PORTFOLIO_PHASES).includes("Resonance"), false);
  assert.equal(JSON.stringify(PORTFOLIO_PHASES).includes("Quicksilver"), false);
});

test("missing health stays at inventory", () => {
  const verdict = classifyPortfolioPhase({ id: "unnamed" });
  assert.equal(verdict.satisfiedPhase, 0);
  assert.equal(verdict.blockedAt, 1);
  assert.equal(verdict.secretsInvented, false);
  assert.equal(verdict.agentActions.length > 0, true);
});

test("ready 503 naming a missing key is an owner gate, not an agent secret task", () => {
  const verdict = classifyPortfolioPhase({
    id: "plane",
    healthStatus: 200,
    readyStatus: 503,
    missingRequired: ["SUPABASE_SERVICE_ROLE_KEY", "not a key"],
    ownerGates: ["set resonancenexus env"],
  });
  assert.equal(verdict.satisfiedPhase, 1);
  assert.equal(verdict.blockedAt, 2);
  assert.equal(verdict.ownerActions[0], "set required config by name only: SUPABASE_SERVICE_ROLE_KEY");
  assert.equal(verdict.agentActions.some((action) => action.includes("do not invent")), true);
  assert.equal(JSON.stringify(verdict).includes("eyJ"), false);
  assert.equal(verdict.secretsInvented, false);
});

test("aligned ready surface clears contract parity and stops on orphan branches", () => {
  const verdict = classifyPortfolioPhase({
    id: "bridge",
    healthStatus: 200,
    readyStatus: 200,
    contractRevision: "2026-10-03-ready-surface",
    expectedContractRevision: "2026-10-03-ready-surface",
    orphanBranches: 1,
    keepRedOpen: 4,
  });
  assert.equal(verdict.satisfiedPhase, 3);
  assert.equal(verdict.blockedAt, 4);
  assert.equal(verdict.doNotMerge, true);
  assert.equal(verdict.agentActions.some((action) => action.includes("orphan")), true);
  assert.equal(verdict.agentActions.some((action) => action.includes("keep-red")), true);
});

test("revision mismatch is not contract parity", () => {
  const verdict = classifyPortfolioPhase({
    id: "bridge",
    healthStatus: 200,
    readyStatus: 200,
    contractRevision: "old",
    expectedContractRevision: "2026-10-03-ready-surface",
  });
  assert.equal(verdict.satisfiedPhase, 2);
  assert.equal(verdict.blockedAt, 3);
});

test("device proof is an owner gate after hygiene", () => {
  const verdict = classifyPortfolioPhase({
    id: "device",
    healthStatus: 200,
    readyStatus: 200,
    orphanBranches: 0,
    ownerGates: ["archive IPA on iPhone 16e"],
    requiredCiGreen: false,
  });
  assert.equal(verdict.satisfiedPhase, 4);
  assert.equal(verdict.blockedAt, 5);
  assert.equal(verdict.ownerActions[0], "archive IPA on iPhone 16e");
  assert.equal(verdict.doNotMerge, true);
});

test("archived project is steady and demands nothing", () => {
  const verdict = classifyPortfolioPhase({ id: "legacy-mcp", archived: true, healthStatus: 404 });
  assert.equal(verdict.satisfiedPhase, 9);
  assert.equal(verdict.blockedAt, null);
  assert.deepEqual(verdict.ownerActions, []);
  assert.deepEqual(verdict.agentActions, []);
});

test("portfolio sort puts the least advanced project first", () => {
  const ranked = classifyPortfolio([
    { id: "b", archived: true },
    { id: "a", healthStatus: 200, readyStatus: 503, missingRequired: ["SUPABASE_SERVICE_ROLE_KEY"] },
  ]);
  assert.deepEqual(ranked.map((item) => item.id), ["a", "b"]);
  assert.equal(ranked[0].satisfiedPhase, 1);
  assert.equal(ranked[1].satisfiedPhase, 9);
});
