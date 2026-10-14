# Conduit — 10-Phase Production-Readiness Roadmap (refined 2026-10-14 06:00 EDT)

Purpose: Conduit is a project-agnostic TypeScript MCP coordination bridge (agents, tasks, grants, integrations) running on Render with Postgres. It does not own other projects' posture; portfolio-wide classifiers do not belong here (see #210).

Principles: provider-neutral, free-tier only, no secrets in code, every phase reversible, fail-closed by default.
Live 2026-10-13 ~18:05 EDT: `/ready` 200 (0.8.0, postgres), `/mcp` 401 unauthenticated. Baseline coverage 77%, `index.ts` 0%.
Known red check: Cloudflare Workers Builds fails on every PR; it is not a deploy target (owner: disconnect it, or keep #213's honest handler).
Evidence: docs/AUDIT-2026-10-13.md.

| # | Phase | Goal | PRs / work | Exit criteria |
|---|---|---|---|---|
| 1 | Green truth | CI that can be trusted | #197 SHA pins/least privilege, #198 deps; owner: disconnect Workers Builds, required checks | main green 7 days; only real checks required |
| 2 | One wiring | Tests run what production runs | #211 `index.ts` thin wrapper over app-factory | `index.ts` < 30 lines; e2e covers prod wiring |
| 3 | Lockdown by construction | Prod safety not tied to one env var | #206 prod lockdown, #212 capabilities required on prod, #209 trust proxy | Prod markers × dev flags all refuse at startup |
| 4 | Minimal public surface | Unauthenticated routes do no work for others | #208 diagnostics cache, #207 typed tool inputs, #213 honest Workers handler | Public: `/`, `/health`, `/ready`, OAuth metadata only |
| 5 | Transport security | Verified DB TLS | One shared `postgresSsl()` policy for every pool (#162 or #155, consolidate per #201); set Render `DATABASE_SSL_*` first | Live `/ready` green with verification on |
| 6 | Signed cursors + pagination perf | Unforgeable, cheap cursors | #204 Bolt consolidation (closes #200/#202 scope), HMAC cursors from #162 | Tampered cursors rejected; codec fuzz test |
| 7 | Per-tool capability gates | Least privilege | Capability map per tool; deny-by-default for `integration_call`/`mcp_bridge_call`; audited grants | Contract test: every tool declares a gate |
| 8 | Ordered migrations + one pool | Safe schema evolution | Forward-only migrations (#120 draft) with checksums/dry-run; consolidate the four pg pools | Fresh + upgrade-from-0.8.0 on CI Postgres |
| 9 | Contract tests + coverage gate | Pinned protocol edge | #214 coverage gate; MCP tool/schema snapshots; Postgres parity suite | ≥ 80% on auth/store/mcp; schema drift fails CI |
| 10 | Operable 0.9.0 | Repeatable, observable release | #216 finite timeouts; structured redacted logs; SSE drain (#119 draft); changelog, tag, rollback runbook | Tagged 0.9.0; live smoke green; rollback rehearsed |

## Merge order
1. #197 → #198 (CI/deps) → 2. #206 → #211, #212 (stacked on #206) → #209 → 3. #207, #208, #213 → 4. #204 → #216 → #214 (gate last, at the new baseline) → 5. one of #210 (recommended: remove out-of-scope portfolio script) or #203, never both → 6. TLS (#155/#162 consolidated) only after Render env is set → 7. #205 (this doc).

Held: #187, #190 (portfolio lattice/admission experiments, conflicting, do-not-merge), #119/#120 (draft, keep red), #155/#162 (owner TLS decision #201). Closed this pass: #199 (superseded by this doc).

Status 2026-10-14 06:00 EDT: all audit PRs mergeable; only Workers Builds is red; nothing merged; stale docs/Bolt/release branches pruned (see #202).
