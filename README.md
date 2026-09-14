# Conduit 0.7.0

Standalone remote MCP coordination and integration bridge for AI agents, tools, connectors, skills, MCP servers, shared context, and development resources.

## Purpose

Conduit is a **project-agnostic development coordination layer**. It connects participating agents and development resources through one authenticated MCP endpoint and provides shared context, work coordination, project/resource discovery, and an auditable activity trail.

Resonance was the initial project Conduit was created to help develop. It does not define Conduit and is not a runtime component of Conduit.

## Capabilities

- authenticated MCP access
- authenticated actor-to-agent identity binding
- agent registration and discovery
- project creation and project-scoped coordination
- generic resource registration and discovery
- task creation, atomic claiming, completion, and ownership-safe handoffs
- shared contacts and resource references
- shared tool and MCP endpoint discovery
- unified global or project-scoped coordination context
- activity/audit history with project attribution
- least-privilege capability grants for external integrations and MCP bridge calls
- bounded actor/tool/outbound rate limiting
- cursor-bounded coordination reads
- self-service MCP/OAuth interoperability diagnostics
- authenticated task lifecycle event streaming at `/events`
- health and readiness endpoints
- PostgreSQL persistence when `DATABASE_URL` is configured
- in-memory development mode when no database is configured

## MCP contract

The public MCP surface includes identity and context tools (`agent_identity`, `development_context`, `conduit_context`), agent/project/resource coordination, integration and MCP bridge calls, capability grant governance (`grant_create`, `grant_revoke`, `grants_list`), `conduit_diagnostics`, task lifecycle operations, contacts, tool discovery, and activity history.

Successful tool results include JSON text plus `structuredContent` so hosts can parse either representation. Tool failures use a stable structured envelope and set `isError: true`.

List/get tools advertise `readOnlyHint` and `idempotentHint`. Integration and MCP bridge tools advertise `openWorldHint`. Mutating task completion, handoff, and grant revocation advertise `destructiveHint`.

### Capability grants

Production external calls are deny-by-default. A grant binds an agent to a provider, HTTP method, and safe path pattern, optionally scoped to a project and expiry. Supported providers are `github`, `render`, `supabase`, and `mcp_bridge`.

Project creators or subjects listed in `CONDUIT_GRANT_ADMIN_SUBJECTS` govern project grants. Global grants require a configured grant administrator. Grant records are auditable and revocable; expired or revoked grants never authorize calls.

A registered resource or tool is never an authorization grant. The existing MCP bridge SSRF protections remain authoritative even when a capability grant exists.

### Rate limiting

Conduit applies bounded sliding-window limits per authenticated actor, per MCP tool, and per outbound provider. HTTP callers receive `429` with `Retry-After`. Limits and windows can be configured through `CONDUIT_RATE_*`, `CONDUIT_TOOL_RATE_*`, and `CONDUIT_EXTERNAL_RATE_*` environment variables.

### Pagination

Coordination list tools accept `limit` and opaque `cursor` parameters. Responses use `{ items, nextCursor? }` and hard-cap page sizes. `conduit_context` bounds every collection it returns, preventing a single context request from becoming an unbounded database dump.

### Diagnostics

`conduit_diagnostics` is read-only. It checks Conduit's health, both RFC 9728 protected-resource metadata locations, authorization-server metadata, JWKS reachability, scope parity, and CIMD/DCR advertisement. It only probes Conduit's own configured origin and never returns access tokens, secrets, private keys, database URLs, or provider credentials.

## Runtime

- Node.js 20+
- TypeScript
- MCP TypeScript SDK v2
- Express
- PostgreSQL when `DATABASE_URL` is configured
- Render-compatible HTTP deployment

The MCP endpoint is `/mcp`. The service also exposes `/health`, `/ready`, and authenticated `/events`.

## Authentication

Production Conduit is an OAuth 2.1 resource server. Descope is the authorization server and issues access tokens for the Conduit MCP resource.

Configure:

```text
PUBLIC_URL=https://conduit-feco.onrender.com
MCP_RESOURCE_URL=https://conduit-feco.onrender.com/mcp
DESCOPE_MCP_SERVER_WELL_KNOWN_URL=<Descope MCP Server .well-known URL>
DESCOPE_MCP_SERVER_ISSUER=<Descope MCP Server issuer>
CONDUIT_READ_SCOPE=mcp:conduit.read
CONDUIT_WRITE_SCOPE=mcp:conduit.write
CONDUIT_GRANT_ADMIN_SUBJECTS=<comma-separated trusted actor subjects>
# Optional: comma-separated browser origins to restrict
MCP_ALLOWED_ORIGINS=
```

The server validates JWT signatures using discovered JWKS, verifies issuer, audience, algorithm, subject, and expiry, and enforces scopes before tool execution. After authentication, an actor binds to a logical Conduit agent identity; normal write operations cannot impersonate another bound agent.

`CONDUIT_TOKEN` is development-only and is rejected as an MCP authentication path in production. Anonymous MCP access is disabled by default and is only available when explicitly enabled outside production.

### Standards-compliant discovery

Conduit publishes identical RFC 9728 Protected Resource Metadata at:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-protected-resource/mcp`

Authorization Server metadata is available at `/.well-known/oauth-authorization-server`. Hosts should use CIMD when supported and DCR as fallback; clients complete the normal authorization-code + PKCE flow.

### Connecting hosts

Paste this URL into the host's custom connector / remote MCP flow:

```text
https://conduit-feco.onrender.com/mcp
```

The expected sequence is:

1. Receive `401` with `resource_metadata`
2. Load protected-resource metadata
3. Discover the authorization server
4. Use CIMD or DCR + authorization code + PKCE
5. Retry `/mcp` with a Bearer access token whose `aud` is the MCP resource URL

## Event stream

`GET /events` is an authenticated Server-Sent Events stream for task lifecycle coordination. Use `?projectId=<id>` for project filtering. Events include task create, claim, block, release, complete, and handoff activity. The stream sends recent activity on connect, heartbeats while idle, and new activity as it appears.

## Station (optional)

Set `CONDUIT_STATION=1` to enable a **read-only** HTML monitor at `/station` (tasks and grants).

- Auth: same Bearer token / OAuth as `/events` and `/mcp`
- Optional filter: `/station?projectId=...`
- JSON: `/station?format=json` or `Accept: application/json`
- No claim/complete/grant mutations from this UI

## Coordination model

Projects are optional coordination domains. Existing unscoped workflows remain valid, while tasks, contacts, tools, resources, and activity can be associated with a project for isolation and focused context.

Resources are metadata/references to development assets such as repositories, services, environments, documentation sources, MCP endpoints, and external systems. Registering a resource does not grant Conduit permission to execute the referenced endpoint, and resource records must not contain credentials or secrets.

Conduit can forward authenticated GitHub, Render, and Supabase API calls through `integration_call`, and can forward JSON-RPC to remote HTTPS MCP endpoints through `mcp_bridge_call`. Both adapters are high-risk and use server-side credentials or outbound network. Capability grants are the authorization boundary for production external calls.

`mcp_bridge_call` resolves the target hostname, rejects private/loopback/link-local/ULA/multicast/embedded-IPv4 addresses, pins the subsequent HTTPS connection to those validated addresses, refuses HTTP redirects, and sends `MCP-Protocol-Version`. Linear is not a built-in adapter.

## Persistence

Set `DATABASE_URL` to use PostgreSQL. Startup initializes the schema and indexes automatically using additive migrations. Capability grants are persisted in the `capability_grants` table. Without a database, Conduit uses an in-memory store for local development.

PostgreSQL provides atomic task claims, ownership-safe completion and handoff, durable project/resource records, durable identity bindings, durable activity events, and durable capability grants.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm start
```

## Verification

GitHub Actions runs typecheck, tests, and build. Production verification covers `/health`, `/ready`, OAuth metadata parity, authentication challenges, MCP connectivity, diagnostics, bounded coordination reads, capability policy, and the authenticated event stream.

## Boundary

Conduit coordinates agents and resources; it does not become part of the application being developed. Project-specific information belongs in project/resource/context records rather than Conduit's core identity.
