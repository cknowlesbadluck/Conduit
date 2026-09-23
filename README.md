# Conduit 0.8.0

Standalone remote MCP coordination and integration bridge for AI agents, tools, connectors, skills, MCP servers, shared context, and development resources.

## Purpose

Conduit is a **project-agnostic development coordination layer**.

It connects participating agents and development resources through one authenticated MCP endpoint and provides shared context, work coordination, project/resource discovery, and an auditable activity trail.

Resonance was the initial project Conduit was created to help develop.
It does not define Conduit and is not a runtime component of Conduit.

## Capabilities

- authenticated MCP access
- authenticated actor-to-agent identity binding
- agent registration and discovery
- project creation and project-scoped coordination
- generic resource registration and discovery
- task creation, atomic claiming, completion, and ownership-safe handoffs
- shared contacts and resource references
- shared tool and MCP endpoint discovery
- capability grants for controlled external integration and MCP bridge calls
- authenticated activity history and live task lifecycle events
- unified global or project-scoped coordination context

## Non-goals

- Conduit is not a general-purpose GitHub, Render, or Linear client
- Conduit does not store provider secrets inside resource records
- Conduit is not project-specific to Resonance or any other application
- Conduit does not require paid infrastructure beyond the free tiers already in use

## MCP contract

The public MCP surface includes identity and context tools (`agent_identity`, `development_context`, `conduit_context`), agent/project/resource coordination, integration and MCP bridge calls, capability grant governance (`grant_create`, `grant_revoke`, `grants_list`), `conduit_diagnostics`, task lifecycle operations, contacts, tool discovery, and activity history.

### Capability grants

Production external calls are deny-by-default. A grant binds an agent to a provider, HTTP method, and safe path pattern, optionally scoped to a project and expiry. Supported providers are `github`, `render`, `supabase`, and `mcp_bridge`.

`pathPattern` is glob syntax (exact, single-segment `*`, terminal `/**`, or trailing prefix `*`), not regex. Patterns must start with `/`. A leading `^` or trailing `.*` is stored but never matches. Prefer `/prefix/**` or `/prefix*`. See `docs/references/auth-debugging.md`.

Project creators or subjects listed in `CONDUIT_GRANT_ADMIN_SUBJECTS` govern project grants. Global grants require a configured grant administrator. Grant records are auditable and revocable; expired or revoked grants never authorize calls.

A registered resource or tool is never an authorization grant. The existing MCP bridge SSRF protections remain authoritative even when a capability grant exists.

### Rate limiting

Authenticated actors and outbound external calls are rate-limited. Exceeding limits returns HTTP 429 with Retry-After.

### Pagination

List tools accept `limit` + opaque `cursor` and return `{ items, nextCursor? }`.

## Runtime

- Node.js 20+
- TypeScript
- MCP TypeScript SDK v2
- Express
- PostgreSQL when `DATABASE_URL` is configured
- Render-compatible HTTP deployment

The MCP endpoint is `/mcp`.
The service also exposes `/health`, `/ready`, and authenticated `/events`.

## Deployment

Deployed on Render as a web service. See service `srv-dabgm3ks728c739rmt50` and endpoint `https://conduit-feco.onrender.com/mcp`.

## License

Private / project use unless otherwise stated.
