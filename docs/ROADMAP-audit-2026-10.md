# Conduit 10-Phase Roadmap (audit 2026-10-13)

| # | Phase | Goal / deliverables | Exit criteria | Risk |
|---|---|---|---|---|
| 1 | CI & supply-chain hardening | SHA-pinned actions, least-privilege `permissions`, concurrency, in-range dep bumps, Dependabot | All workflows pinned + scoped; CI green | Low |
| 2 | Branch/PR hygiene | Triage 12 open PRs (5 overlapping Bolt pagination PRs → 1), drop stale roadmap/hygiene branches | <5 open PRs, no orphan branches | Low |
| 3 | DB TLS by default | Land #155/#162 consolidated once Render env set | `rejectUnauthorized` on in prod, verified | Med (outage if env wrong) |
| 4 | Ordered migrations | Finish #120: versioned, idempotent migrations + rollback notes | Fresh + upgrade paths tested in CI Postgres | Med |
| 5 | Auth & input validation | Review auth.ts/actor-binding, zod on all tool inputs, signed cursors | Negative tests per tool | Med |
| 6 | Event streams & shutdown | Finish #119: SSE admission limits, graceful drain | Load test passes, no leaked sockets | Med |
| 7 | Observability | Structured logs, request ids, no secret/env leakage in errors/diagnostics | Log redaction tests | Low |
| 8 | Test depth | Coverage reporting, Postgres store parity, MCP contract tests | Coverage ≥80% on store/auth | Low |
| 9 | Docs consolidation | One ROADMAP, README/SPEC drift fixed, prune portfolio docs | Docs-hygiene workflow green, single source | Low |
| 10 | Release 0.9.0 | Changelog, tag, deploy runbook, live-smoke gate | Tagged release, smoke green | Med |
