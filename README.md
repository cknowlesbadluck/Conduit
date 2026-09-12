# Conduit

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
- health and readiness endpoints
- PostgreSQL persistence when `DATABASE_URL` is configured
- in-memory development mode when no database is configured

## Runtime

- Node.js 20+
- TypeScript
- MCP TypeScript SDK v2
- Express
- PostgreSQL when `DATABASE_URL` is configured
- Render-compatible HTTP deployment

The MCP endpoint is `/mcp`. The service also exposes `/health` and `/ready`.

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
# Optional: comma-separated browser origins to restrict (for example, https://chatgpt.com)
MCP_ALLOWED_ORIGINS=
```

The server validates JWT signatures using discovered JWKS, verifies issuer, audience, algorithm, subject, and expiry, and enforces scopes before tool execution. After authentication, an actor binds to a logical Conduit agent identity; normal write operations cannot impersonate another bound agent.

OAuth discovery and MCP requests send the CORS headers required by browser-based hosts. By default, any origin may initiate the bearer-token OAuth flow; this is safe because Conduit does not use cookie authentication. Set `MCP_ALLOWED_ORIGINS` to a comma-separated list of allowed HTTPS origins when a stricter browser-origin policy is required.

### Standards-compliant discovery (no manual client credentials)

Conduit publishes identical RFC 9728 Protected Resource Metadata at:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-protected-resource/mcp` (the URL clients follow from the 401 `WWW-Authenticate` header)

Authorization Server metadata (including `registration_endpoint` for Dynamic Client Registration) is available at `/.well-known/oauth-authorization-server`.

In the Descope console for this MCP Server, enable **Client ID Metadata Documents (CIMD)** and keep **Dynamic Client Registration (DCR)** as fallback. That lets ChatGPT, Claude, Grok, Gemini, Jules, and other MCP hosts register themselves at connect time — paste the MCP URL, complete consent, done. Do not pre-manufacture per-client OAuth credentials.

### Connecting hosts

Paste this URL into the host's custom connector / remote MCP flow:

```text
https://conduit-feco.onrender.com/mcp
```

The host should:

1. Receive `401` with `resource_metadata`
2. Load protected-resource metadata
3. Discover the authorization server
4. Use DCR or CIMD + authorization code + PKCE
5. Retry `/mcp` with a Bearer access token whose `aud` is the MCP resource URL

For controlled development, `CONDUIT_TOKEN` enables a static bearer token. Anonymous MCP access is disabled by default and is only available when explicitly enabled outside production.

## Coordination model

Projects are optional coordination domains. Existing unscoped workflows remain valid, while tasks, contacts, tools, resources, and activity can be associated with a project for isolation and focused context.

Resources are metadata/references to development assets such as repositories, services, environments, documentation sources, MCP endpoints, and external systems. Registering a resource does not grant Conduit permission to execute the referenced endpoint, and resource records must not contain credentials or secrets.

Conduit does not directly execute GitHub, Render, Linear, Supabase, or arbitrary MCP operations. Those integrations can be added as separately authenticated adapters in future work.

## Persistence

Set `DATABASE_URL` to use PostgreSQL. Startup initializes the schema and indexes automatically using additive migrations. Without a database, Conduit uses an in-memory store for local development.

PostgreSQL provides atomic task claims, ownership-safe completion and handoff, durable project/resource records, durable identity bindings, and durable activity events.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm start
```

## Verification

GitHub Actions runs typecheck, tests, and build. Production verification covers `/health`, `/ready`, OAuth metadata parity (root + path-specific PRM), authentication challenges, MCP connectivity, and the coordination surface.

## Boundary

Conduit coordinates agents and resources; it does not become part of the application being developed. Project-specific information belongs in project/resource/context records rather than Conduit's core identity.
