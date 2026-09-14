# Conduit Specification

## Value Proposition
Conduit is an MCP bridge that lets compatible AI agents and development tools securely share context, coordinate work, and invoke governed tools/resources through one controlled integration surface. It is a separate infrastructure project, not Resonance itself.

**Primary users:** AI agents and developers operating across ChatGPT/Codex, Claude, Grok, Gemini, Jules, and connected development services.

**Core actions:**
1. Authenticate and establish a trusted agent identity.
2. Coordinate shared projects, tasks, context, and handoffs.
3. Invoke explicitly authorized integrations and controlled bridge operations.

## Why LLM?
**Conversational win:** agents can discover context, claim work, hand off tasks, and use tools without each integration requiring a bespoke UI.

**LLM adds:** intent interpretation, planning, task decomposition, agent-to-agent handoff, and selection of appropriate governed capabilities.

**What the LLM lacks:** authoritative project state, durable coordination state, credentials, external APIs, and trusted authorization. Conduit supplies those through server-side controls.

## UI / Client Experience
Conduit is primarily an MCP server. Client experiences are supplied by connected AI assistants. An optional read-only Station UI (`/station`, enabled with `CONDUIT_STATION=1`) can monitor tasks and capability grants for authenticated operators; it does not replace MCP clients or perform mutations.

**First interaction:** an MCP client authenticates and initializes against the protected MCP endpoint.

**Core interaction:** the client discovers available tools, establishes identity, reads or writes authorized project/task/context state, and invokes only capabilities granted to its authenticated identity.

**End state:** requested work is completed, handed off, or recorded with durable state and auditable authorization boundaries.

## Product Context
- **Repository:** `cknowlesbadluck/Conduit`
- **Production MCP endpoint:** `https://conduit-feco.onrender.com/mcp`
- **Transport:** MCP over HTTP with protected resources and authenticated event streaming.
- **Authorization:** OAuth 2.1-compatible flow backed by Descope; JWT validation uses JWKS and strict issuer/audience/algorithm checks.
- **Persistence:** PostgreSQL.
- **Integrations:** governed provider operations such as GitHub, Render, and Supabase.
- **Bridge:** controlled outbound MCP/HTTP operations with SSRF and redirect defenses.
- **Constraints:** preserve the existing architecture; hardening must be incremental and regression-tested; production paths should remain compatible with supported MCP clients.

## Security Requirements
- Production OAuth discovery and all derived security endpoints must use HTTPS and trusted issuer configuration.
- Authenticated identities must remain bound to their Conduit agent identity; callers cannot impersonate arbitrary agents.
- Grant visibility must be restricted to authorized administrators, project governors/owners, or the caller's own grants.
- Outbound bridge/integration requests must remain constrained by origin, path, DNS/IP safety, redirects, size, and timeout policies.
- Sensitive credentials, query strings, and authorization material must not be emitted to logs.
- Production request sizes, rate limits, and event subscriber resources must be bounded.

## Reliability Requirements
- PostgreSQL-backed collections use real keyset/cursor pagination rather than loading entire datasets into memory.
- Context sections have independent cursors.
- Transactional task claim/handoff/complete operations remain concurrency-safe.
- Database TLS certificate verification is supported in production.
- Event delivery remains bounded and resilient under reconnects and replay.

## Verification Requirements
- Unit and regression tests cover every security fix.
- Authenticated production-like MCP E2E coverage proves initialize, identity, project/resource/task lifecycle, capabilities, and events.
- Negative security tests cover authorization isolation, OAuth trust, SSRF, redirects, malformed inputs, and concurrency.
- CI performs typecheck, tests, build, and dependency/security checks.
- Release artifacts have consistent version metadata and deployment identity.
