import test from "node:test";
import assert from "node:assert/strict";
import { decideGrantListVisibility } from "./grant-tools.js";

test("grants_list denies another agent's grants to a non-owner caller", () => {
  const decision = decideGrantListVisibility({
    requestedAgentId: "agent_other",
    callerAgentId: "agent_self",
    isAdmin: false,
    governsRequestedProject: false,
  });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.error, "grant_not_visible");
});

test("grants_list scopes a normal caller to their own agent id", () => {
  const decision = decideGrantListVisibility({
    callerAgentId: "agent_self",
    isAdmin: false,
    governsRequestedProject: false,
  });
  assert.equal(decision.ok, true);
  if (decision.ok) {
    assert.equal(decision.agentId, "agent_self");
    assert.equal(decision.includeRevoked, false);
  }
});

test("grants_list lets a project owner filter by any agent in that project", () => {
  const decision = decideGrantListVisibility({
    requestedAgentId: "agent_other",
    requestedProjectId: "proj_1",
    includeRevoked: true,
    callerAgentId: "agent_owner",
    isAdmin: false,
    governsRequestedProject: true,
  });
  assert.equal(decision.ok, true);
  if (decision.ok) {
    assert.equal(decision.agentId, "agent_other");
    assert.equal(decision.projectId, "proj_1");
    assert.equal(decision.includeRevoked, true);
  }
});

test("grants_list still requires a scope even for admins", () => {
  const decision = decideGrantListVisibility({
    callerAgentId: "admin",
    isAdmin: true,
    governsRequestedProject: false,
  });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.error, "grant_scope_required");
});
