# Conduit Schematic UI Design

**Date:** 2026-09-15  
**Status:** Approved for implementation  
**Scope:** Small operational web UI for the existing Node/Express Conduit service.

## Goal

Give Conduit a simple technical interface that immediately shows whether the service is online, which agents are connected, what capabilities are exposed, active work, and recent activity. The interface must read like a system schematic rather than a generic SaaS dashboard.

## Constraints

- Conduit remains a separate MCP/bridge service; do not describe or model it as a nexus.
- Preserve the existing Node/Express runtime and `/mcp`, `/health`, and `/ready` endpoints.
- Keep the UI dependency-free: plain HTML, CSS, and browser JavaScript served by Express.
- Keep the visual language schematic: thin lines, rectangular nodes, restrained active-state accent, no 3D effects, no excessive animation.
- The UI must remain useful if only Grok is connected.
- Do not claim an agent is connected unless the server has actual connection/activity data for it.
- Do not expose secrets, bearer tokens, OAuth credentials, or raw authorization headers.
- The UI is operational/status-oriented, not a replacement for the MCP protocol endpoint.

## Interface

### Header

- `CONDUIT` label.
- Service version from the existing version source.
- Overall service state: ONLINE / DEGRADED / OFFLINE based on health data.

### Schematic

Center node: `CONDUIT / MCP`.

Agent nodes connect to the center with directional lines. A known active connection is rendered as an active solid line; unavailable or unobserved agents are not invented. The initial implementation uses server-observed activity to identify connected agents and shows Grok when its authenticated activity is present.

Selecting a node opens a compact inspection panel rather than navigating away.

### Lower sections

Four compact tabs/sections:

1. **Connections** — agent identity, connection state, last activity.
2. **Tools** — exposed tool names and short descriptions from the server's existing MCP capability surface.
3. **Tasks** — current coordination tasks if the existing coordination store exposes them; otherwise a clear empty state.
4. **Activity** — recent safe operational events with timestamps and event type; secrets and authorization material are excluded.

### Responsive behavior

Desktop uses a two-column schematic/inspection layout. Narrow screens stack the schematic above the inspection/details region. No horizontal scrolling is required.

## Data boundary

Add one read-only status endpoint for the UI, e.g. `/status`, that returns a sanitized snapshot. It must be derived from existing server/store state and never expose credentials. The browser must not call `/mcp` directly for dashboard data.

Suggested response shape:

```json
{
  "service": "Conduit",
  "version": "0.8.0",
  "status": "online",
  "connections": [
    {"id": "grok", "label": "Grok", "status": "connected", "lastActivity": "..."}
  ],
  "tools": [
    {"name": "...", "description": "..."}
  ],
  "tasks": [],
  "activity": []
}
```

The implementation may use a smaller subset when a capability is not available from the current server state; empty arrays are preferable to fabricated data.

## Implementation

- Add a focused `src/ui.ts` module containing the HTML/CSS/JS template or separate static assets if that produces a cleaner boundary.
- Add a focused status projection module if existing state access is too coupled to the HTTP layer.
- Change the root route from JSON-only to the UI page while retaining machine-readable status through `/status`.
- Preserve the existing security headers, updating CSP only as necessary for the dependency-free local UI assets.
- Add endpoint/UI tests for `/`, `/status`, responsive markup essentials, version rendering, and secret redaction.

## Non-goals

- No chat interface.
- No agent marketplace.
- No account/admin console.
- No metrics-heavy analytics dashboard.
- No visual 3D network graph.
- No new authentication system.
- No replacement for the MCP client/host experience.
