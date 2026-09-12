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

## Identity and safety

- Treat the authenticated Conduit actor as the source of truth for the current agent identity.
- Register the current logical agent before identity-bound writes when the server requires it.
- Never impersonate another agent or overwrite another agent's ownership.
- Use ownership-safe claim, completion, and handoff operations instead of mutating task ownership indirectly.
- Do not store API keys, OAuth client secrets, bearer tokens, passwords, or other credentials in Conduit resources or context.
- A registered resource is a reference/metadata record; it does not grant permission to execute that external resource.

## Project boundaries

Projects are optional coordination domains. Keep project-specific context inside its project/resource/task records. Do not redefine Conduit's core identity around a consuming project.

## External integrations

Conduit coordinates references to GitHub, Render, Linear, Supabase, MCP servers, and other systems. It does not automatically inherit permission to operate those systems. Use the corresponding authenticated integration when an external mutation is actually required.

## OAuth

The bundled MCP server is the deployed Conduit endpoint. Hosts should use its standards-based OAuth discovery and PKCE flow. Do not ask users to paste static Conduit tokens or manufacture per-client OAuth credentials when the host can complete dynamic registration or client-ID metadata discovery.

## Typical workflow

1. Establish the authenticated Conduit actor.
2. Register/discover the agent identity if needed.
3. Inspect the relevant project and current coordination context.
4. Find an existing task before creating a duplicate.
5. Claim work atomically before modifying task-owned state.
6. Perform the work through the appropriate tool or repository integration.
7. Complete the task with a concise result, or hand it off while preserving ownership semantics.
8. Leave useful activity/context for the next agent.
