# Conduit Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Conduit into a current, authenticated, durable, test-gated remote MCP coordination service.

**Architecture:** Upgrade the MCP HTTP layer to `@modelcontextprotocol/server` v2 with stateless handling. Isolate authentication, coordination state, and HTTP concerns; use Descope for OAuth/OIDC and PostgreSQL for durable state when configured.

**Tech Stack:** Node.js 20+, TypeScript, Express 5, MCP TypeScript SDK v2, Zod 4, PostgreSQL, Descope, Render, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-01-conduit-production-hardening-design.md`

## Global Constraints

- Conduit is standalone and must not modify Resonance.
- GitHub `cknowlesbadluck/Conduit` is the source of truth.
- Render remains the primary deployment target.
- No paid infrastructure is required for the baseline implementation.
- No secrets are committed to GitHub.
- MCP authorization follows the 2026-07-28 security model.

---

### Task 1: Establish the failing verification gate

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `src/smoke.test.ts`
- Test: `src/smoke.test.ts`

**Interfaces:**
- CI runs `npm install`, `npm run typecheck`, `npm test`, and `npm run build`.
- The smoke suite must fail for the current incorrect ownership assertion and then pass after the store is corrected.

- [ ] Write tests for claim rejection, completion ownership, and missing-task behavior.
- [ ] Verify the test suite exposes the current incorrect behavior.
- [ ] Add CI workflow.
- [ ] Commit the red test/CI gate.

### Task 2: Upgrade MCP SDK and HTTP boundary

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `src/index.ts`
- Create: `src/auth.ts`
- Create: `src/mcp.ts`
- Create: `src/http.ts`

**Interfaces:**
- `createMcpHandler` is the HTTP MCP entry point.
- Auth middleware exposes validated identity to tool handlers.
- MCP factory registers all Conduit tools without embedding storage logic.

- [ ] Update dependencies to stable MCP v2 and compatible Zod.
- [ ] Add failing auth/metadata tests.
- [ ] Implement protected-resource metadata and Descope token verification.
- [ ] Implement stateless MCP handler and host/origin safeguards.
- [ ] Add scope-aware tool registration.
- [ ] Verify typecheck/build.

### Task 3: Harden coordination persistence and semantics

**Files:**
- Modify: `src/store.ts`
- Create: `src/store.test.ts`

**Interfaces:**
- Store operations return typed domain objects or `null` for invalid ownership/state transitions.
- PostgreSQL and in-memory implementations expose the same behavior.
- Activity is durable when PostgreSQL is configured.

- [ ] Add failing tests for all task transitions and handoffs.
- [ ] Implement correct in-memory semantics.
- [ ] Persist activity events in PostgreSQL.
- [ ] Validate agent ownership for handoff.
- [ ] Add indexes and constraints needed for coordination queries.
- [ ] Verify tests/typecheck/build.

### Task 4: Operational hardening and documentation

**Files:**
- Modify: `src/index.ts`
- Modify: `README.md`
- Create: `.env.example`

- [ ] Add readiness state that reflects database initialization.
- [ ] Bound JSON request bodies and return consistent error envelopes.
- [ ] Document Render environment variables, Descope discovery URL, resource URL, scopes, and private-token development mode.
- [ ] Document the MCP endpoint and discovery endpoints.

### Task 5: Release verification

**Files:**
- No source changes unless verification finds defects.

- [ ] Run CI and inspect all checks.
- [ ] Update Render service only after repository checks pass.
- [ ] Deploy from the hardening branch for validation.
- [ ] Smoke test `/health`, `/ready`, OAuth protected-resource metadata, and `/mcp` authentication behavior.
- [ ] Exercise a complete agent registration → task create → claim → handoff → complete workflow.
- [ ] Promote the validated commit to `main`.
- [ ] Trigger/confirm production Render deployment.
- [ ] Inspect runtime logs and metrics.
