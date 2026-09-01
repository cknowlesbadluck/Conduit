# Conduit Production Hardening Design

**Date:** 2026-09-01
**Status:** Approved for implementation by the project owner

## Goal

Turn Conduit from a minimal live MCP prototype into a reliable remote coordination plane for agents, with current MCP protocol support, secure OAuth/OIDC authentication, durable state, deterministic task semantics, auditability, health/readiness checks, and automated verification.

## Architecture

Conduit remains a standalone service. GitHub is the source of truth and Render remains the primary deployment target. The MCP HTTP surface will move to the stable `@modelcontextprotocol/server` v2 SDK and stateless HTTP handler, while the coordination store remains independent of the transport layer.

Authentication is delegated to Descope as the OAuth/OIDC authorization server. Conduit will expose protected-resource metadata, validate Descope JWTs, enforce audience/issuer/signature/expiry and tool scopes, and retain a bearer-token mode only for explicitly controlled development/private deployments. No credential is committed to GitHub.

PostgreSQL is the durable source of truth when `DATABASE_URL` is configured. In-memory storage remains a deterministic development fallback. Task operations are ownership-aware and atomic in PostgreSQL. Activity/audit events are persisted rather than process-local only.

## MCP surface

Core tools remain:
- agent_register
- agents_list
- task_create
- task_list
- task_claim
- task_complete
- task_handoff
- contact_add
- contacts_list
- tool_register
- tools_list
- activity_list

The transport will support the current MCP 2026-07-28 revision through the v2 SDK while preserving compatible stateless legacy traffic where the SDK provides it.

## Security

- `/mcp` is authenticated when OAuth configuration is enabled.
- `401` responses advertise the protected-resource metadata location.
- Descope issuer and MCP resource/audience are configurable by environment variables.
- Tool-level scopes are enforced for mutating operations.
- Authorization headers are never logged.
- Secrets exist only in deployment environment variables.
- Private bearer-token mode is opt-in and never replaces configured OAuth in production.

## Operational requirements

- `/health` checks process health.
- `/ready` checks initialization and database readiness.
- Startup fails cleanly on required database initialization errors.
- JSON request size is bounded.
- Origin/host protections are applied where appropriate.
- CI performs typecheck, build, and tests.
- Render deployment runs the same verification gate before starting the service.

## Verification

The release gate is: failing tests first, then implementation, then full test/typecheck/build verification, then Render deployment and live endpoint smoke tests. No completion claim is made from a successful commit alone.
