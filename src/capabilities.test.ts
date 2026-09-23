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

// --- Regression: ChatGPT → Render grant used trailing single-star prefix ---
test("trailing single-star prefix matches exact service path (Render regression)", () => {
  const g = grant({
    provider: "render",
    method: "GET",
    pathPattern: "/v1/services/srv-dabgm3ks728c739rmt50*",
  });
  const req = request({
    provider: "render",
    method: "GET",
    path: "/v1/services/srv-dabgm3ks728c739rmt50",
  });
  assert.equal(matchesCapability(g, req), true);
});

test("trailing single-star prefix matches subpaths under the same service id", () => {
  const g = grant({
    provider: "render",
    method: "GET",
    pathPattern: "/v1/services/srv-dabgm3ks728c739rmt50*",
  });
  assert.equal(
    matchesCapability(g, request({
      provider: "render",
      method: "GET",
      path: "/v1/services/srv-dabgm3ks728c739rmt50/deploys",
    })),
    true,
  );
});

test("trailing single-star prefix does not authorize a different service id", () => {
  const g = grant({
    provider: "render",
    method: "GET",
    pathPattern: "/v1/services/srv-dabgm3ks728c739rmt50*",
  });
  assert.equal(
    matchesCapability(g, request({
      provider: "render",
      method: "GET",
      path: "/v1/services/srv-other-service-id",
    })),
    false,
  );
});

test("GET grant does not authorize POST/PATCH/DELETE", () => {
  const g = grant({
    provider: "render",
    method: "GET",
    pathPattern: "/v1/services/srv-dabgm3ks728c739rmt50*",
  });
  for (const method of ["POST", "PATCH", "DELETE", "PUT"] as const) {
    assert.equal(
      matchesCapability(g, request({
        provider: "render",
        method,
        path: "/v1/services/srv-dabgm3ks728c739rmt50",
      })),
      false,
      `GET grant must not authorize ${method}`,
    );
  }
});

test("agent without matching grant remains denied", () => {
  const g = grant({
    agentId: "chatgpt",
    provider: "render",
    method: "GET",
    pathPattern: "/v1/services/srv-dabgm3ks728c739rmt50*",
  });
  assert.equal(
    matchesCapability(g, request({
      agentId: "other-agent",
      provider: "render",
      method: "GET",
      path: "/v1/services/srv-dabgm3ks728c739rmt50",
    })),
    false,
  );
});

test("project-scoped grant does not match different projectId", () => {
  const g = grant({
    projectId: "proj_a",
    provider: "render",
    method: "GET",
    pathPattern: "/v1/services/srv-dabgm3ks728c739rmt50*",
  });
  assert.equal(
    matchesCapability(g, request({
      provider: "render",
      method: "GET",
      path: "/v1/services/srv-dabgm3ks728c739rmt50",
      projectId: "proj_b",
    })),
    false,
  );
  // null/global request against project-scoped grant is denied
  assert.equal(
    matchesCapability(g, request({
      provider: "render",
      method: "GET",
      path: "/v1/services/srv-dabgm3ks728c739rmt50",
    })),
    false,
  );
});

test("global (null project) grant matches any projectId or none", () => {
  const g = grant({
    // no projectId
    provider: "render",
    method: "GET",
    pathPattern: "/v1/services/srv-dabgm3ks728c739rmt50*",
  });
  assert.equal(
    matchesCapability(g, request({
      provider: "render",
      method: "GET",
      path: "/v1/services/srv-dabgm3ks728c739rmt50",
    })),
    true,
  );
  assert.equal(
    matchesCapability(g, request({
      provider: "render",
      method: "GET",
      path: "/v1/services/srv-dabgm3ks728c739rmt50",
      projectId: "any-project",
    })),
    true,
  );
});

test("/** recursive form still preferred and works for Render service", () => {
  const g = grant({
    provider: "render",
    method: "GET",
    pathPattern: "/v1/services/srv-dabgm3ks728c739rmt50/**",
  });
  assert.equal(
    matchesCapability(g, request({
      provider: "render",
      method: "GET",
      path: "/v1/services/srv-dabgm3ks728c739rmt50",
    })),
    true,
  );
  assert.equal(
    matchesCapability(g, request({
      provider: "render",
      method: "GET",
      path: "/v1/services/srv-dabgm3ks728c739rmt50/env-vars",
    })),
    true,
  );
});

test("regex-style trailing .* still does not match (documented non-glob)", () => {
  const g = grant({
    provider: "render",
    method: "GET",
    pathPattern: "/v1/services/srv-dabgm3ks728c739rmt50.*",
  });
  // ends with ".*" not single "*", so falls through to segment match which fails length/equality
  assert.equal(
    matchesCapability(g, request({
      provider: "render",
      method: "GET",
      path: "/v1/services/srv-dabgm3ks728c739rmt50",
    })),
    false,
  );
});
