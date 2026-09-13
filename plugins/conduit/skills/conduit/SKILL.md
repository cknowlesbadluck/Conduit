---
name: conduit
description: Use Conduit when coordinating AI agents or shared development work across tasks, projects, resources, tools, MCP endpoints, or handoffs. Register the current agent before identity-bound writes and preserve Conduit's project and ownership boundaries.
---

# Conduit

Conduit is a project-agnostic coordination layer exposed through a remote MCP server. Use it to create shared coordination state between ChatGPT, Codex, and other compatible agents.

## Use Conduit for

- registering or discovering participating agents
- discovering or creating projects
- creating, claiming, completing, and handing off tasks
- discovering shared resources, tools, and MCP endpoints
- reading project or global coordination context
- recording or inspecting auditable activity
- coordinating work without giving Conduit direct credentials to external systems
- granting narrowly scoped external capabilities when authorized
- running `conduit_diagnostics` before troubleshooting MCP/OAuth interoperability

## Identity and safety

- Treat the authenticated Conduit actor as the source of truth for the current agent identity.
- Register the current logical agent before identity-bound writes when the server requires it.
- Never impersonate another agent or overwrite another agent's ownership.
- Use ownership-safe claim, completion, and handoff operations instead of mutating task ownership indirectly.
- Do not store API keys, OAuth client secrets, bearer tokens, passwords, or other credentials in Conduit resources or context.
- A registered resource is a reference/metadata record; it does not grant permission to execute that external resource.
- Tool failures return `{ error: { code, message, details? } }` with `isError: true`. Handle `code`; do not scrape `message`.

## Capability grants

Production external calls are deny-by-default. Use `grant_create` only when you are authorized to govern the project or are a configured grant administrator. Scope grants as narrowly as possible by provider, method, project, path pattern, and expiry. Use `grant_revoke` when access is no longer required and `grants_list` to inspect current grants.

A grant authorizes only the matching provider operation. It never bypasses the MCP bridge's SSRF/DNS protections.

## Rate limits and pagination

Expect HTTP `429` with `Retry-After` when request, tool, or outbound-provider limits are exceeded. Coordination lists are bounded and use `limit` plus opaque `cursor` values. Prefer small pages and follow `nextCursor` rather than assuming a complete list is returned.

## Diagnostics and events

`conduit_diagnostics` safely checks Conduit's own health, protected-resource metadata, authorization-server metadata, JWKS, scope parity, and CIMD/DCR advertisement. It never returns tokens or provider credentials.

Use authenticated `GET /events` when a client supports Server-Sent Events and needs near-real-time task lifecycle notifications. Filter by project when possible. The stream is complementary to MCP task tools; it does not replace ownership checks.

## Project boundaries

Projects are optional coordination domains. Keep project-specific context inside its project/resource/task records. Do not redefine Conduit's core identity around a consuming project.

## External integrations

Conduit can forward GitHub, Render, and Supabase API calls through `integration_call`, and JSON-RPC to remote HTTPS MCP endpoints through `mcp_bridge_call`. Registering a resource or tool does not authorize those calls. Both adapters are high-risk and require matching capability grants in production. Linear is not a built-in adapter. Private, loopback, and DNS-rebinding targets are rejected by the bridge.

## OAuth

The bundled MCP server is the deployed Conduit endpoint. Hosts should use its standards-based OAuth discovery and PKCE flow. Do not ask users to paste static Conduit tokens or manufacture per-client OAuth credentials when the host can complete dynamic registration or client-ID metadata discovery. Static bearer-token mode is development-only.

## Typical workflow

1. Establish the authenticated Conduit actor.
2. Register/discover the agent identity if needed.
3. Inspect the relevant project and current coordination context.
4. Find an existing task before creating a duplicate.
5. Claim work atomically before modifying task-owned state.
6. Verify required external capability grants before calling integrations or the bridge.
7. Perform the work through the appropriate tool or repository integration.
8. Complete the task with a concise result, or hand it off while preserving ownership semantics.
9. Leave useful activity/context for the next agent and consume event notifications when available.
