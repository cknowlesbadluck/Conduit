# Conduit Plugin

Codex/ChatGPT plugin bundle for the Conduit remote MCP coordination service.

## What it provides

- Remote MCP binding to the deployed Conduit service
- Conduit coordination skill for agent identity, tasks, projects, resources, and handoffs
- No embedded credentials or per-host static OAuth secrets

## MCP endpoint

`https://conduit-feco.onrender.com/mcp`

The endpoint uses Conduit's OAuth 2.1 resource-server flow. Compatible hosts should discover the protected resource and authorization-server metadata, complete authorization with PKCE, and retry the MCP connection with the resulting bearer token.

## Repository boundary

This directory is the installable plugin surface. The repository root remains the Conduit server source and deployment project.
