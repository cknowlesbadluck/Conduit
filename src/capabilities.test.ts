import test from "node:test";
import assert from "node:assert/strict";
import { assertCapability, matchesCapability, type CapabilityGrant, type CapabilityRequest } from "./capabilities.js";

const grant = (overrides: Partial<CapabilityGrant> = {}): CapabilityGrant => ({
  id: "grant_1",
  agentId: "agent_1",
  provider: "github",
  method: "GET",
  pathPattern: "/repos/cknowlesbadluck/Conduit/**",
  createdBy: "admin",
  createdAt: new Date().toISOString(),
  ...overrides,
});

const request = (overrides: Partial<CapabilityRequest> = {}): CapabilityRequest => ({
  agentId: "agent_1",
  provider: "github",
  method: "GET",
  path: "/repos/cknowlesbadluck/Conduit/issues",
  ...overrides,
});

test("capability matcher accepts exact provider, method, and terminal recursive path", () => {
  assert.equal(matchesCapability(grant(), request()), true);
  assert.equal(matchesCapability(grant(), request({ path: "/repos/cknowlesbadluck/Other/issues" })), false);
});

test("capability matcher supports one-segment wildcard", () => {
  const g = grant({ pathPattern: "/repos/*/Conduit/issues" });
  assert.equal(matchesCapability(g, request({ path: "/repos/cknowlesbadluck/Conduit/issues" })), true);
  assert.equal(matchesCapability(g, request({ path: "/repos/cknowlesbadluck/Conduit/issues/42" })), false);
});

test("capability matcher denies expired grants", () => {
  const g = grant({ expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(matchesCapability(g, request()), false);
});

test("capability matcher enforces agent and provider identity", () => {
  assert.equal(matchesCapability(grant(), request({ agentId: "agent_2" })), false);
  assert.equal(matchesCapability(grant(), request({ provider: "render" })), false);
});

test("capability assertion is deny-by-default", () => {
  assert.throws(() => assertCapability([], request()), /capability_denied/);
  assert.doesNotThrow(() => assertCapability([grant()], request()));
});
