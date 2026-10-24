# Conduit: 10-phase roadmap (Conduit only)

Scope: the TS/Express MCP bridge on Render's free tier. This is separate from the portfolio roadmap (`docs/PORTFOLIO-ROADMAP-10-PHASE.md`). Conduit does not depend on code from Resonance or QuicksilverV1, only on documented HTTP/MCP contracts.
Tags: **[passed]** · **[in progress]** · **[blocked]** (needs owner). Last observed 2026-10-24 05:02 ET: `/ready` 200 (0.8.0, contractRevision 2026-10-03-ready-surface, postgres). Main CI, Live Smoke and Lockfile Sync green. 277 tests pass, tsc and eslint clean. 0 Dependabot alerts. 27 open PRs.
Phases are ordered by leverage: each one makes the later ones cheaper or safer.

| # | Phase | Concrete tasks | Exit criteria | Status |
|---|---|---|---|---|
| 1 | PR entropy down | Close superseded Bolt perf PRs (#267/#275/#276/#283/#297 into #204 or close). Rebase or close the CHANGES_REQUESTED backlog older than 14 days. | ≤10 open PRs; none older than 14d without an owner label | [in progress] |
| 2 | Green, pinned CI | Owner disconnects Cloudflare "Workers Builds: conduit" (always fails, adds noise). Keep every action pinned by SHA. Keep Lockfile Sync running. | Every required check on every PR is meaningful and green on main | [blocked] (owner: Workers Builds) |
| 3 | Fail-closed auth | Land #206/#212 so lockdown does not depend on NODE_ENV alone. #234: grant expiry fails closed. #238: grant admin subject match. Owner reviews each auth PR. | Authz matrix test covers every tool × {no token, wrong scope, expired grant, admin} | [in progress] (owner review) |
| 4 | Bounded surface | SSE cap returns 503 with Retry-After (#217). Diagnostics fan-out cache (#208). One shared pg pool (#251). Proxy trust for real-IP rate limits (#209, owner). | Load test: 2× the SSE cap and a burst of diagnostics give no unhandled rejection and no memory growth | [in progress] |
| 5 | Transport + data security | Postgres TLS verify (#155) after Render env is set. Ordered migrations (#120) applied by owner. | `sslmode=verify-full` live. Migration ledger matches the DB. | [blocked] (owner) |
| 6 | Honest posture | `/ready` reports commitSha (#247). Scheduled portfolio-probe workflow actually runs from main. Report Vercel alias drift. | Probe artifact every 6h. A deploy/main SHA mismatch raises an alert. | [in progress] |
| 7 | Contracts + coverage | Tool-surface snapshot ✓. Raise the coverage gate to ≥70% lines. Add a contract test for `/ready` shape. | Coverage gate ≥70/70/70 enforced in CI | [in progress] |
| 8 | Operable release | Runbook (cold start, rollback, rotate secrets). Tag 0.9.0. Graceful SSE drain (#119). | A rollback has been rehearsed. Tagged release notes exist. | [in progress] |
| 9 | Bridge trust | Destination allowlist for mcp_bridge_call (#256, report-first). Signed HMAC grant receipts (#257) with an offline verifier. | Every bridged call is attributable and verifiable offline | [in progress] |
| 10 | Free-tier and ecosystem fit | MCP SDK 2.4 Skills extension (`ext/skills`) to publish Conduit's operating skills read-only. Document free-tier cold start (keep-warm probe within free limits). | Zero paid add-ons. Skills listed over MCP. Cold start p95 documented. | [in progress] |

## Risks
- Pushes straight to main with the owner token (cc0b7df, 2026-10-24 02:01 ET, agent unknown). No branch protection means any token holder can bypass review.
- Render free tier: cold starts, and the single instance makes the in-memory SSE and rate-limit state per-process.
- The auth PR backlog (#206/#212/#234/#238) leaves NODE_ENV-dependent lockdown in production until it is reviewed.

## Innovation ideas (practical, no lock-in)
1. **Skills over MCP (SDK 2.4)**: expose the runbook and probe skills as read-only MCP skills, so any client can discover how to operate Conduit.
2. **Grant receipts + offline verifier** (#257): tamper-evident audit without a paid log service.
3. **Squash-aware safe-delete report** (#298): branch pruning backed by evidence, kept report-only.
4. **Deploy-parity probe**: compare the commitSha in `/ready` with main HEAD every 6h, using a free Actions cron.
