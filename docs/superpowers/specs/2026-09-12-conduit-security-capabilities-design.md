# Conduit v0.7 Security, Capability, and Interoperability Design

## Goal
Harden Conduit from a coarse shared-credential MCP bridge into a policy-enforced coordination and credential-brokering layer while preserving the v0.6.1 MCP/OAuth architecture.

## Scope
This change implements five security/operational tracks and one later-but-included coordination track:

1. Capability grants for `integration_call` and `mcp_bridge_call`.
2. Per-actor, per-tool, and outbound rate limiting.
3. Bounded pagination for list/context surfaces.
4. `conduit_diagnostics` for protocol/OAuth self-diagnosis.
5. Removal of the production static bearer-token fallback.
6. Task lifecycle event streaming over an authenticated SSE endpoint.

Render, Descope, PostgreSQL, and MCP SDK v2 remain in place. The broken `fix/ready-db-probe-0.6.2` branch remains untouched.

## Capability model
A grant authorizes one logical agent to perform a constrained provider operation. A grant contains:

- `id`
- optional `projectId`
- `agentId`
- `provider` (`github`, `render`, `supabase`, or `mcp_bridge`)
- `method` (`GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, or `*`)
- `pathPattern`
- optional `expiresAt`
- `createdBy`
- `createdAt`

Path patterns use safe prefix/glob semantics: literal prefixes plus a terminal `/**` wildcard; a single `*` matches one path segment. For `mcp_bridge`, the pattern is matched against the normalized HTTPS URL path plus origin. No grant can override the bridge's existing SSRF protections.

Capability checks are deny-by-default when capability enforcement is enabled. Production enables enforcement. Development/test can explicitly disable it with `CONDUIT_CAPABILITIES_REQUIRED=false`.

Grant governance:
- A project grant may be created/revoked by the project's creator or an actor listed in `CONDUIT_GRANT_ADMIN_SUBJECTS`.
- Global grants without a project require a configured grant-admin subject.
- A grant creator cannot grant a capability to another agent unless they are authorized by those rules.
- Every create/revoke action is recorded in activity.
- Expired grants are denied and retained for audit.

MCP tools:
- `grant_create`
- `grant_revoke`
- `grants_list`

## Rate limiting
Use an in-process token-bucket/sliding-window limiter with bounded memory and deterministic cleanup. Limits apply before expensive tool work:

- authenticated actor: general MCP request limit
- actor + tool: tighter tool-specific limit
- actor + outbound provider/bridge: tighter external-call limit
- unauthenticated requests are limited separately

Return HTTP 429 with `Retry-After` at the HTTP boundary. Tool-level repeated calls that reach the handler are additionally guarded by the same actor/tool limiter so future transports cannot bypass the policy. No provider credentials are ever included in rate-limit errors.

## Pagination and bounded responses
All list surfaces accept `limit` and `cursor` where practical and return `{items, nextCursor}`. Defaults are conservative and maximums are hard-capped. Existing `activity_list` retains its `limit` input while gaining cursor support.

Bounded surfaces:
- agents_list
- projects_list
- resources_list
- task_list
- contacts_list
- tools_list
- activity_list
- conduit_context

`conduit_context` uses bounded sections and exposes cursors rather than dumping unbounded state. Existing callers that omit pagination continue to receive the first page.

## Diagnostics
`conduit_diagnostics` is read-only and returns only operational metadata:

- MCP endpoint reachability
- protected-resource metadata at root and path-specific locations
- authorization-server metadata reachability
- issuer/JWKS reachability
- advertised OAuth scopes
- configured Conduit scope parity
- CIMD/DCR advertisement
- authentication mode
- bridge health

Diagnostics never returns tokens, secrets, credential environment values, private keys, database URLs, or provider credential material.

The tool accepts an optional `baseUrl`; by default it derives the configured public URL. External probes are restricted to Conduit's own configured origins to prevent the diagnostic tool becoming a network scanner.

## Static-token path
`CONDUIT_TOKEN` is removed from production startup. `/mcp` is disabled unless OAuth/Descope is configured in production. Development can still use `CONDUIT_TOKEN` only when `NODE_ENV !== production`, and the comparison uses a timing-safe buffer comparison.

## Event push
Add authenticated `GET /events` SSE for task lifecycle events:
- task created
- claimed
- blocked
- released
- completed
- handed off

Subscribers can filter by project. The event publisher is fed from the same activity/event path as state mutations. PostgreSQL deployments use `LISTEN/NOTIFY` so multiple application instances can fan out events; in-memory mode uses an in-process subscriber registry. SSE has bounded connection counts and heartbeat cleanup.

The MCP tool surface remains MCP-native; SSE is an auxiliary coordination stream for clients that explicitly support it.

## Error and compatibility behavior
All new policy failures use Conduit's existing structured error envelope. Capability denial identifies provider/method/path only at the minimum detail necessary and never reveals credential state. Existing SSRF protections remain authoritative.

## Testing
Every new behavior gets unit/integration coverage in memory mode. Store parity tests cover PostgreSQL and in-memory semantics where existing test infrastructure supports both. CI must pass typecheck, tests, and build. Live smoke adds diagnostics and event endpoint health checks without requiring a production credential.
