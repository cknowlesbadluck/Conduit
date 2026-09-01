# Conduit

Standalone remote MCP coordination bridge for agents and development tooling.

Conduit provides a shared coordination plane for:

- agent registration and discovery
- task creation, claiming, completion, and ownership-safe handoffs
- shared contacts/resources
- shared tool and MCP endpoint discovery
- activity/audit history

## Runtime

- Node.js 20+
- TypeScript
- MCP TypeScript SDK v2 (`2026-07-28` protocol)
- Express
- PostgreSQL when `DATABASE_URL` is configured
- Render-compatible HTTP deployment

The MCP endpoint is `/mcp`. The service also exposes `/health` and `/ready`.

## Authentication

Production Conduit is designed as an OAuth 2.1 resource server. Descope is the authorization server and issues access tokens for the Conduit MCP resource.

Configure:

```text
PUBLIC_URL=https://conduit-feco.onrender.com
MCP_RESOURCE_URL=https://conduit-feco.onrender.com/mcp
DESCOPE_MCP_SERVER_WELL_KNOWN_URL=<Descope MCP Server .well-known URL>
DESCOPE_MCP_SERVER_ISSUER=<Descope MCP Server issuer>
CONDUIT_READ_SCOPE=mcp:conduit.read
CONDUIT_WRITE_SCOPE=mcp:conduit.write
```

The Descope MCP Server should expose the two Conduit scopes. The server validates the JWT signature using the discovered JWKS, verifies issuer, audience, algorithm, subject, and expiry, and enforces scopes before tool execution.

Conduit exposes OAuth Protected Resource Metadata at the MCP well-known endpoint and advertises the Descope authorization server through `WWW-Authenticate` challenges.

For controlled development, `CONDUIT_TOKEN` enables a static bearer token. Anonymous MCP access is disabled by default and is only available when explicitly enabled outside production.

## Persistence

Set `DATABASE_URL` to use PostgreSQL. Startup initializes the schema and indexes automatically. Without a database, Conduit uses an in-memory store for local development.

PostgreSQL provides atomic task claims, ownership-safe completion and handoff, durable handoff records, and durable activity events.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm start
```

`npm test` builds TypeScript first and then runs the compiled Node test suite.

## Verification

GitHub Actions runs typecheck, tests, and build. Render deployments should only be promoted after those checks pass and the live `/health`, `/ready`, OAuth metadata, authentication challenge, MCP handshake, and end-to-end task lifecycle have been verified.

## Project boundary

Conduit is independent of Resonance. Changes in this repository are not changes to Resonance.
