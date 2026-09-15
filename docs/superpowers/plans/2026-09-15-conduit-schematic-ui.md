# Conduit Schematic UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small dependency-free operational web UI to Conduit that renders the service as a simple schematic and exposes sanitized connection, tool, task, and activity status.

**Architecture:** Keep Node/Express as the canonical runtime. Add a read-only `/status` projection using existing store data, and serve a dependency-free HTML/CSS/JS page from `/`; do not alter MCP transport semantics.

**Tech Stack:** Node.js 22, TypeScript, Express, plain HTML/CSS/browser JavaScript, existing Conduit store and test stack.

**Spec:** `docs/superpowers/specs/2026-09-15-conduit-schematic-ui-design.md`

## Global Constraints

- Conduit remains a separate MCP/bridge service and is never described as a nexus.
- Preserve `/mcp`, `/health`, and `/ready` behavior.
- UI has no new runtime dependency.
- Never expose secrets, tokens, OAuth credentials, or authorization headers.
- Empty data must be represented honestly; never fabricate agent connections or activity.
- Keep the visual system schematic, compact, technical, and responsive.

---

### Task 1: Add sanitized UI status projection

**Files:**
- Create: `src/status.ts`
- Test: `src/status.test.ts`

**Interfaces:**
- Consumes: `listAgents()`, `listTasks()`, `listTools()`, `listActivity()`, `VERSION`, `SERVICE_NAME`.
- Produces: `getConduitStatus(): Promise<ConduitStatus>` where `ConduitStatus` contains `service`, `version`, `status`, `connections`, `tools`, `tasks`, and `activity`.

- [ ] **Step 1: Write the failing tests**

Create tests using the existing memory-store test convention. Assert that the projection includes service/version, maps registered agents, returns tasks/tools/activity, and strips sensitive activity fields containing token/key/secret/password/auth material.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --test-name-pattern=status`
Expected: FAIL because `src/status.ts` does not yet exist.

- [ ] **Step 3: Implement the minimal projection**

Import the existing store list functions. Map agents to connection records with `status: "connected"` only when their latest activity actor matches the agent identity; otherwise use `status: "registered"`. Limit activity to a small recent set and redact sensitive keys before returning it. Never return resource endpoints that contain credentials.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- --test-name-pattern=status`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/status.ts src/status.test.ts
git commit -m "feat: add sanitized conduit status projection"
```

### Task 2: Serve the schematic UI

**Files:**
- Create: `src/ui.ts`
- Modify: `src/app-factory.ts`
- Test: `src/ui.test.ts`
- Test: `src/app-factory.test.ts` (extend existing route coverage if present)

**Interfaces:**
- Consumes: `getConduitStatus()` and existing Express app factory.
- Produces: `conduitUiHtml()` and `/status` JSON route.

- [ ] **Step 1: Write failing route/UI tests**

Assert `/` returns HTML containing `CONDUIT`, `CONDUIT / MCP`, the four section labels, and a status container; assert `/status` returns JSON with the sanitized status shape.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npm test -- --test-name-pattern="UI|status route|root route"`
Expected: FAIL because the root route still returns JSON and `/status` is absent.

- [ ] **Step 3: Implement the HTML template**

Create a dependency-free HTML document with:
- compact header and service status;
- central `CONDUIT / MCP` node;
- dynamically rendered connection nodes and lines;
- inspection/details panel;
- Connections, Tools, Tasks, Activity sections;
- mobile media query;
- browser script that fetches `/status` and renders sanitized text with DOM text APIs, never `innerHTML` for server data.

Use a single restrained accent for active states, thin borders/lines, and no external fonts, images, libraries, or network calls.

- [ ] **Step 4: Implement routes and CSP compatibility**

Change `/` to return the UI HTML and add `/status` to return `getConduitStatus()`. Keep existing `/mcp`, `/health`, and `/ready` unchanged. Update the CSP to permit only the local inline style/script required by the page; keep `frame-ancestors 'none'` and disallow all external network sources.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- --test-name-pattern="UI|status route|root route"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui.ts src/ui.test.ts src/app-factory.ts src/app-factory.test.ts
git commit -m "feat: add Conduit schematic web interface"
```

### Task 3: Verify typecheck, full test suite, and build

**Files:**
- Modify: only files required by verification failures; do not broaden UI scope.

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: PASS with zero TypeScript errors.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS for all existing and new tests.

- [ ] **Step 3: Run the production build**

Run: `npm run build`
Expected: PASS and produce the normal compiled output.

- [ ] **Step 4: Inspect the rendered route contract**

Start the service with the existing development/test configuration and verify `/` is HTML, `/status` is JSON, `/health` remains `200`, `/ready` remains `200`, and `/mcp` retains its existing authentication behavior.

- [ ] **Step 5: Commit any verification-only corrections**

Use a focused commit such as `fix: correct schematic UI verification issue` only if required by actual test output.

### Task 4: Open a pull request and report the finished result

**Files:**
- No source changes unless required by review.

- [ ] **Step 1: Push branch and open PR**

Create a PR from `feat/schematic-ui` to `main` titled `feat: add simple Conduit schematic UI`, describing the new `/` UI, `/status` projection, preserved MCP boundary, and tests.

- [ ] **Step 2: Review the PR diff**

Confirm no credentials, unrelated project changes, or invented connection states are present.

- [ ] **Step 3: Report completion**

Provide the PR number, test/build results, and exact deployed route expectations. Do not claim Render deployment until deployment is actually confirmed.
