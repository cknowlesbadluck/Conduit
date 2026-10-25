# Conduit: 10-phase roadmap (Conduit only), refreshed 2026-10-24 21:00 ET

Scope: the TS/Express MCP bridge on Render free tier. Separate from `docs/PORTFOLIO-ROADMAP-10-PHASE.md`. Conduit consumes only documented HTTP/MCP contracts from Resonance/QuicksilverV1, never their code.

**Observed 21:00 ET:** `/ready` 200 first try (0.8.0, `2026-10-03-ready-surface`, postgres). Main CI, Live Smoke and portfolio-probe green. 0 Dependabot alerts. 21 open PRs (#308–#312 ready to merge pending owner; #302/#305/#307 carry stale CodeRabbit CHANGES_REQUESTED whose findings are already fixed; #313/#314/#315 new). "Workers Builds: conduit" fails on every PR and is noise. Score 7.5.

Tags: **[passed]** · **[in progress]** · **[blocked]** (owner).

| # | Phase | Goal | Concrete tasks | Exit criteria | Risks | Status |
|---|---|---|---|---|---|---|
| 1 | PR entropy down | One queue a human can clear in an hour | Owner merges #308–#312; re-request CodeRabbit on #302/#305/#307 (fixes pushed); decide #275 (Bolt capability fast-path: security-adjacent, needs review or close); land #313 gate | ≤10 open PRs, none >14d without an owner label | Auth backlog (#206/#212/#234/#238/#243) ages into rebase hell | [in progress] |
| 2 | Meaningful CI | Every red check means something | Owner disconnects Cloudflare Workers Builds; #313 fail-on-cancelled gate (gate tests now run in CI); keep actions SHA-pinned | Every check on every PR is green or a real failure; 20 consecutive green main runs | Owner action required | [blocked] Workers Builds |
| 3 | Fail-closed auth | Prod lockdown never hinges on NODE_ENV | Review/merge #206, #212, #234, #238, #243; authz matrix test (tool × no token/wrong scope/expired/admin) | Matrix test on main; each PR human-approved | Behaviour change can lock out live clients | [in progress] owner review |
| 4 | Bounded surface | No unbounded input, fan-out or connection | #209 trust proxy (owner); SSE cap with Retry-After; one shared pg pool; request timeouts on every outbound fetch | Load test at 2× SSE cap returns 503+Retry-After, no OOM | Render free-tier memory | [in progress] |
| 5 | DB safety | Certificates verified, schema ordered | #155 TLS verify after owner sets Render env; #120 ordered migrations stays draft until owner plans it | TLS verified in prod; migrations runner dry-run documented | Prod outage if TLS lands before env | [blocked] owner env |
| 6 | Observable probes | Probe output distinguishes cold start from outage | #314 classifier + #315 wiring (`startup`, `attempts`, `firstOkAttempt` on every result); #305 alias drift; #308 revision skew; #309 entropy trend | portfolio-probe report shows `startup` per plane; cold-start false alarms → 0 | Probe PRs #305–#309 touch the same file; merge in order | [in progress] |
| 7 | Contract discipline | MCP tool surface and /ready shape are versioned | #307 tool-surface discovery vs docs; schema files per contractRevision; changelog entry required on any contract change | CI fails on undocumented tool or field | False positives on refactors | [in progress] |
| 8 | Hygiene automation | Weekly report instead of manual passes | #302 hygiene checklist in scheduled workflow (read-only); squash-aware stale-branch report (log only, never deletes) | Weekly checklist artifact; manual audits drop to one per week | Noise if thresholds wrong | [in progress] |
| 9 | Performance | Hot paths measured before optimised | Benchmark capability matching and pagination; re-evaluate #204/#275 against numbers | p95 tool-call overhead documented; perf PRs carry benchmarks | Premature optimisation in authz code | not started |
| 10 | 1.0 | Stable, documented bridge | Semver 1.0 contractRevision; runbook (cold start, rollback, key rotation by owner); deprecation policy | 30 days green main, 0 alerts, ≤10 PRs, authz matrix + load test on main | Free-tier limits may force a paid decision (owner) | not started |

## High-leverage innovations
- **Cold-start-aware probing (#314/#315):** report `cold_start` separately from `down`, so Render spin-up stops looking like outages. Next: carry `startup` into the portfolio score as report-only trend data.
- **Self-describing contract:** generate the documented MCP tool list and `/ready` schema from code and diff them in CI (#307 does the first half).
- **Entropy budget gate (#309):** fail the report-only workflow when open-PR count or age passes a committed baseline, so PR sprawl gets caught early.
- **Fail-on-cancelled test gate (#313):** stops a green run from hiding tests that never ran.

## Top risks (blunt)
1. Five auth/security PRs have waited about 7 days for human review. This is the largest real risk.
2. Probe PRs stacked on one file (#305–#309, #314/#315) make merge order matter. Merge oldest first, then rebase the rest.
3. Workers Builds noise teaches everyone to ignore red checks.

## Midnight status (2026-10-25 00:00 ET)
- main CI green (CI run 40119129271, Live Smoke, scheduled portfolio-probe). Local suite on main: 289 tests, 288 pass, 0 fail, 0 cancelled, 1 skipped. `npm audit --omit=dev`: 0 vulnerabilities.
- `/ready` (Render free tier): first probe 200 after a 22.5s cold start; later probes 200 in about 0.35s. contractRevision `2026-10-03-ready-surface`, persistence `postgres`.
- Phase 3/4: #317 adds a fail-closed terminal JSON error handler. Before it, body-parser and route errors fell through to Express's HTML finalhandler, which shows stacks whenever NODE_ENV != production.
- Phase 1: 23 open PRs and 2 open issues (#201 and #202, both owner decisions, kept). That is still far above the ≤10 target. The keep list blocks most closures.
- Open: `MAX_JSON_BODY` is env-controlled with no upper bound. `/mcp` route wiring is duplicated in `index.ts` and `app-factory.ts`, so they can drift.
## Innovation ideas (practical, no lock-in)
1. **Skills over MCP (SDK 2.4)**: expose the runbook and probe skills as read-only MCP skills, so any client can discover how to operate Conduit.
2. **Grant receipts + offline verifier** (#257): tamper-evident audit (for key holders) without a paid log service. Ed25519 is the upgrade path if third-party attribution is needed.
3. **Squash-aware safe-delete report** (#298): branch pruning backed by evidence, kept report-only.
4. **Deploy-parity probe**: compare the commitSha in `/ready` with main HEAD every 6h, using a free Actions cron.

## Late 2026-10-24 status
See [AUDIT-2026-10-24-LATE.md](AUDIT-2026-10-24-LATE.md). `/ready` is ready on 0.8.0 with postgres, main CI is green, and open PRs dropped from 25 to 14. The entropy-trend gate is in #309.
