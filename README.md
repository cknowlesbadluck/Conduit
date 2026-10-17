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

### MCP bridge destination rule

`mcp_bridge_call` takes its endpoint from tool input. On top of the SSRF guard (HTTPS only, private/loopback/link-local targets refused, DNS pinned, no redirects) and capability grants, a destination rule checks whether the endpoint is *known*. An endpoint is known when it matches:

- an entry in `CONDUIT_BRIDGE_ALLOWED_DESTINATIONS` (comma-separated): an exact HTTPS origin (`https://mcp.example.com` or `https://mcp.example.com:8443`, port-exact), an exact host (`mcp.example.com`, any port), or a leading `*.` subdomain rule (`*.example.com` matches `a.example.com` and `a.b.example.com` but **not** `example.com`). No other wildcards; invalid entries are ignored and counted.
- the exact HTTPS origin of a registered, non-archived tool or resource endpoint.

`CONDUIT_BRIDGE_DESTINATION_MODE` selects the behaviour:

| Mode | Behaviour |
| --- | --- |
| `report` (default) | Unknown destinations are still forwarded. Each one logs `mcp.bridge.destination.violation` with a redacted host (`*.example.com#<sha256-8>`) and increments a counter. |
| `enforce` | Unknown destinations are refused with `mcp_endpoint_not_allowlisted` before any network call. If the registry lookup fails, enforce fails closed. |
| `off` | No check, no lookup. |

Unknown mode values fall back to `report`, so a typo never starts refusing traffic. `/diagnostics` and `conduit_diagnostics` include `bridgeDestinations: { mode, modeValid, allowlistEntries, invalidAllowlistEntries, violations, lastViolationAt }`. The counter is per process and contains no hosts. The rule never relaxes the SSRF guard or grants: an allowlisted private address is still refused. Registering a tool or resource is still not an authorization grant. It only marks the origin as known for this rule.

Rollout: run `report` for a while, add the hosts from the violation logs to the allowlist or register them, then set `enforce`.

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
The service also exposes `/health`, `/ready`, unauthenticated rate-limited `/diagnostics`, authenticated `/events` (SSE), and OAuth protected-resource metadata at `/.well-known/oauth-protected-resource` when OAuth is configured. Configuration names and defaults are listed in `.env.example`.

## Deployment

Deployed on Render as a web service. See service `srv-dabgm3ks728c739rmt50` and endpoint `https://conduit-feco.onrender.com/mcp`.

## License

Private / project use unless otherwise stated.
