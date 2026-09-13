# Conduit v0.7 Security, Capability, and Interoperability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement capability grants, rate limiting, bounded pagination, diagnostics, production OAuth-only enforcement, and task lifecycle event streaming without changing Conduit's core MCP/OAuth architecture.

**Architecture:** Add focused policy/event modules around the existing `store.ts`, `mcp.ts`, and Express boundary. Persist capability grants in the existing PostgreSQL store with equivalent in-memory behavior; carry authenticated actor context through request-local storage so integration and bridge adapters enforce grants without duplicating identity logic. Keep the existing v0.6.1 MCP tool contracts backward-compatible except for bounded list inputs and new policy/diagnostic tools.

**Tech Stack:** Node 20+, TypeScript 5.9, Express 5, MCP TypeScript SDK v2, Zod 4, PostgreSQL, jose.

**Spec:** `docs/superpowers/specs/2026-09-12-conduit-security-capabilities-design.md`

## Global Constraints

- Preserve Render, Descope, PostgreSQL, and MCP SDK v2.
- Production MCP authentication is OAuth/Descope only.
- Capability enforcement is deny-by-default in production.
- Existing SSRF protections remain authoritative.
- Never return provider credentials, OAuth tokens, JWKS private material, or database URLs.
- Keep `fix/ready-db-probe-0.6.2` isolated and do not merge it.
- Every production behavior change has a failing test before implementation.
- CI must pass `npm ci`, `npm run typecheck`, `npm test`, and `npm run build`.

---

### Task 1: Capability policy primitives

**Files:**
- Create: `src/capabilities.ts`
- Create: `src/capabilities.test.ts`

**Interfaces:**
- `CapabilityGrant`
- `CapabilityRequest`
- `matchesCapability(grant, request): boolean`
- `assertCapability(grants, request): void`

- [ ] Step 1: Write tests for exact method matching, terminal `/**`, one-segment `*`, expiry denial, provider separation, and deny-by-default.
- [ ] Step 2: Run `npm run compile && CONDUIT_TEST_MEMORY=true node --test dist/capabilities.test.js`; verify the new tests fail because the module is absent.
- [ ] Step 3: Implement the matcher with normalized uppercase methods and safe path-pattern matching.
- [ ] Step 4: Run the focused test and verify green.
- [ ] Step 5: Commit `test/feat: add capability grant policy primitives`.

### Task 2: Persist capability grants

**Files:**
- Modify: `src/store.ts`
- Create: `src/capability-store.test.ts`

**Interfaces:**
- `createCapabilityGrant(input): Promise<CapabilityGrant>`
- `revokeCapabilityGrant(id, actor): Promise<boolean>`
- `listCapabilityGrants(filter): Promise<CapabilityGrant[]>`
- `getCapabilityGrantsForAgent(agentId, projectId?): Promise<CapabilityGrant[]>`

- [ ] Step 1: Add failing memory-store tests for create/list/revoke and project/agent validation.
- [ ] Step 2: Run the focused tests and confirm failure.
- [ ] Step 3: Add PostgreSQL `capability_grants` schema, indexes, and equivalent in-memory storage.
- [ ] Step 4: Implement transactional create/revoke and activity events.
- [ ] Step 5: Run focused and existing store tests.
- [ ] Step 6: Commit `feat: persist capability grants`.

### Task 3: Grant governance tools

**Files:**
- Modify: `src/mcp.ts`
- Create: `src/grants.test.ts`
- Modify: `src/mcp-surface.test.ts`

**Interfaces:**
- `grant_create`
- `grant_revoke`
- `grants_list`

- [ ] Step 1: Add failing MCP tests for project-owner/admin authorization and denial for ordinary agents.
- [ ] Step 2: Verify the new tests fail.
- [ ] Step 3: Register the three tools with structured responses and destructive annotations on revoke.
- [ ] Step 4: Implement `CONDUIT_GRANT_ADMIN_SUBJECTS` parsing and project-owner checks.
- [ ] Step 5: Verify the surface list and focused tests pass.
- [ ] Step 6: Commit `feat: expose capability grant governance tools`.

### Task 4: Enforce capabilities on integrations and bridge

**Files:**
- Create: `src/request-context.ts`
- Create: `src/capability-enforcement.test.ts`
- Modify: `src/integrations.ts`
- Modify: `src/mcp-bridge.ts`
- Modify: `src/mcp.ts`
- Modify: `src/index.ts`

**Interfaces:**
- `runWithRequestContext(context, callback)`
- `getRequestContext()`
- `requireCapability(request)`

- [ ] Step 1: Write failing tests proving a write-scope agent without a grant cannot call GitHub/Render/Supabase or the bridge, while a matching grant succeeds.
- [ ] Step 2: Run focused tests and verify failure.
- [ ] Step 3: Add AsyncLocalStorage request context and set it after authentication.
- [ ] Step 4: Add capability checks to outbound adapters immediately before credentialed network calls.
- [ ] Step 5: Wire `projectId` into capability evaluation and preserve SSRF checks.
- [ ] Step 6: Run focused, integration, and bridge tests.
- [ ] Step 7: Commit `feat: enforce least-privilege integration capabilities`.

### Task 5: Rate limiting

**Files:**
- Create: `src/rate-limit.ts`
- Create: `src/rate-limit.test.ts`
- Modify: `src/index.ts`
- Modify: `src/mcp.ts`

- [ ] Step 1: Write failing tests for actor/tool/provider buckets, expiration, bounded memory, and retry-after calculation.
- [ ] Step 2: Verify failure.
- [ ] Step 3: Implement an in-process sliding-window limiter with cleanup and configurable limits.
- [ ] Step 4: Add HTTP 429 middleware and actor/tool guards for MCP calls.
- [ ] Step 5: Verify rate-limit tests and MCP tests pass.
- [ ] Step 6: Commit `feat: add actor and outbound rate limits`.

### Task 6: Pagination and bounded context

**Files:**
- Modify: `src/store.ts`
- Modify: `src/mcp.ts`
- Create: `src/pagination.test.ts`

**Interfaces:**
- `Page<T> = { items: T[]; nextCursor?: string }`
- list functions accept `{limit,cursor,...filters}`.

- [ ] Step 1: Write failing tests for deterministic cursors and maximum limits across memory mode.
- [ ] Step 2: Verify failure.
- [ ] Step 3: Implement cursor encoding/decoding using created-at/id ordering and hard maximums.
- [ ] Step 4: Add pagination arguments to list tools and bound `conduit_context` sections.
- [ ] Step 5: Verify all existing list behavior still returns the first page when arguments are omitted.
- [ ] Step 6: Commit `feat: bound and paginate coordination reads`.

### Task 7: Diagnostics

**Files:**
- Create: `src/diagnostics.ts`
- Create: `src/diagnostics.test.ts`
- Modify: `src/mcp.ts`
- Modify: `src/mcp-surface.test.ts`

**Interfaces:**
- `runDiagnostics(options): Promise<ConduitDiagnostics>`
- MCP tool `conduit_diagnostics`.

- [ ] Step 1: Write failing tests for metadata reachability, scope parity, CIMD/DCR detection, and secret redaction.
- [ ] Step 2: Verify failure.
- [ ] Step 3: Implement self-origin validation and bounded fetches for health/discovery/PRM metadata.
- [ ] Step 4: Implement OAuth scope comparison without exposing tokens or credential configuration.
- [ ] Step 5: Register the read-only diagnostic tool.
- [ ] Step 6: Verify focused tests and MCP surface tests.
- [ ] Step 7: Commit `feat: add conduit interoperability diagnostics`.

### Task 8: Remove production static bearer fallback

**Files:**
- Modify: `src/index.ts`
- Modify: `src/auth.ts`
- Create: `src/auth-production.test.ts`

- [ ] Step 1: Write failing tests asserting production rejects `CONDUIT_TOKEN` startup and development token comparison is timing-safe.
- [ ] Step 2: Verify failure.
- [ ] Step 3: Remove the production fallback and retain token mode only outside production.
- [ ] Step 4: Add timing-safe comparison for development token mode.
- [ ] Step 5: Verify auth tests and startup behavior.
- [ ] Step 6: Commit `security: remove production static bearer fallback`.

### Task 9: Task lifecycle event bus and SSE

**Files:**
- Create: `src/events.ts`
- Create: `src/events.test.ts`
- Modify: `src/store.ts`
- Modify: `src/index.ts`

**Interfaces:**
- `publishEvent(event): void`
- `subscribeEvents(filter, listener): unsubscribe`
- `GET /events` authenticated SSE endpoint.

- [ ] Step 1: Write failing tests for publish/subscribe filtering, disconnect cleanup, heartbeat timing, and bounded subscribers.
- [ ] Step 2: Verify failure.
- [ ] Step 3: Implement the in-memory event bus and task lifecycle publication.
- [ ] Step 4: Add PostgreSQL LISTEN/NOTIFY fan-out when a database is configured.
- [ ] Step 5: Add authenticated SSE endpoint with project filtering and heartbeat.
- [ ] Step 6: Verify event tests and existing task lifecycle tests.
- [ ] Step 7: Commit `feat: add task lifecycle event stream`.

### Task 10: CI/live smoke and documentation

**Files:**
- Modify: `.github/workflows/live-smoke.yml`
- Modify: `README.md`
- Modify: `plugins/conduit/skills/conduit/SKILL.md`
- Modify: `src/mcp-surface.test.ts`

- [ ] Step 1: Add failing assertions for diagnostics metadata and `/events` health without requiring an OAuth access token.
- [ ] Step 2: Verify the new assertions fail against the old baseline.
- [ ] Step 3: Update smoke workflow to use repository/environment variables for production host identity rather than hardcoded tenant URLs.
- [ ] Step 4: Document capability grants, rate limits, pagination, diagnostics, and event stream usage without documenting secrets.
- [ ] Step 5: Run the complete CI suite.
- [ ] Step 6: Commit `docs: document v0.7 security and interoperability controls`.

### Task 11: Final verification and release candidate

**Files:**
- No source changes unless verification exposes a defect.

- [ ] Run `npm ci`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Inspect GitHub Actions results for the branch.
- [ ] Verify `main` remains unchanged until the release candidate is reviewed.
- [ ] Create a PR from `feat/v0.7-security-capabilities-diagnostics` to `main`.
- [ ] Request a code review and do not merge a failing candidate.
