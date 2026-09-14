# Conduit 0.7.1 Hardening, Stabilization, and Hygiene Design

## Goal
Raise Conduit from production-capable to production-hardened without changing its core architecture or MCP contract unnecessarily. Every security or reliability change must have regression coverage.

## Scope

### 1. Security hardening
- Enforce HTTPS for production OAuth discovery URL and every security endpoint returned by discovery.
- Pin or validate the configured authorization-server issuer and JWKS trust relationship; reject unexpected origins/schemes.
- Close grant-list visibility leakage by enforcing global/project/agent ownership boundaries consistently.
- Re-audit identity binding for caller-controlled agent/project identifiers.
- Preserve and expand SSRF defenses, including DNS rebinding, alternate IP forms, redirects, encoded paths, and provider-origin bypasses.
- Redact authorization material, credentials, integration query strings, and sensitive activity metadata from logs.
- Bound JSON/request payload sizes explicitly.
- Preserve host/origin and security-header protections.

### 2. Persistence and concurrency
- Replace in-memory slicing pagination with PostgreSQL keyset pagination ordered by stable `(created_at, id)` keys where applicable.
- Return independent cursors for independent context sections.
- Preserve transactional locking for task claim/handoff/complete operations and add concurrency stress coverage.
- Introduce explicit migration versioning while preserving safe startup behavior for existing deployments.
- Add production database TLS certificate verification configuration.

### 3. Rate limiting and events
- Keep bounded per-process rate limiting as the safe default, but make the scaling limitation explicit and structure the implementation for a shared backend later.
- Improve event replay/subscriber lifecycle robustness and test reconnect, replay, and concurrent subscribers.
- Avoid unbounded event or activity memory growth.

### 4. Production verification
Add authenticated end-to-end coverage for:
- OAuth authorization/token path.
- MCP initialize and tools/list.
- Authenticated identity resolution and agent binding.
- Project/resource lifecycle.
- Task create/claim/handoff/complete.
- Capability grant/list/use/revoke authorization boundaries.
- Authenticated events and replay.
- Controlled integration calls.
- Controlled MCP bridge calls.
- Negative authorization and SSRF cases.

Add a deployment identity/version check so live smoke tests prove the intended build is actually running.

### 5. CI and hygiene
- Add deliberate dependency vulnerability scanning.
- Check package/package-lock/version consistency.
- Remove dead configuration and stale references.
- Synchronize README, deployment docs, OAuth docs, and plugin metadata with actual behavior.
- Verify clean startup/shutdown and fresh-database initialization.
- Keep Node/runtime assumptions explicit and test supported LTS behavior where practical.
- Prepare a 0.7.1 release gate only after CI and production-like verification pass.

## Non-Goals
- No rewrite of the MCP server architecture.
- No replacement of Descope, PostgreSQL, or existing provider integrations solely for architectural preference.
- No new dashboard/product surface as part of this pass.
- No weakening of existing security controls for client compatibility.

## Acceptance Criteria
1. Existing CI remains green.
2. Every identified P1 security finding has a regression test.
3. Production OAuth discovery rejects insecure/untrusted endpoint configuration.
4. Grant enumeration cannot disclose another project's or agent's grants to an unauthorized caller.
5. Large collections are paginated from PostgreSQL rather than fully materialized before slicing.
6. Context cursors are independent by section.
7. Authenticated MCP E2E tests exercise the critical lifecycle.
8. Security-negative tests demonstrate denial for representative attack classes.
9. Deployment smoke verifies version/build identity as well as readiness and OAuth surfaces.
10. Documentation, package metadata, lockfile, and release version are internally consistent.

## Implementation Order
1. Establish/verify test fixtures and security regression harness.
2. Harden OAuth/discovery and authorization visibility.
3. Harden input/logging/SSRF edges.
4. Implement keyset pagination and context cursor separation.
5. Harden migrations, DB TLS, concurrency, and events.
6. Add authenticated E2E and deployment identity checks.
7. Run CI/security checks and perform documentation/version hygiene.
8. Final verification and release gate.
