# Conduit 10-phase roadmap — refreshed 2026-10-13 18:00 EDT

Live evidence 2026-10-13 ~22:05Z: Conduit `/ready` 200 stamped (0.8.0, 2026-10-03-ready-surface, postgres), `/mcp` 401 unauthenticated. Resonance and Quicksilver state not re-probed from this repo. CHR-55 device acceptance remains open; nothing here claims it. Classifier tests are not production proof.
See docs/AUDIT-2026-10-13.md for findings. Open audit PRs: #197 CI hardening, #198 deps, #199 roadmap, #203 cold_start + cross-plane, #204 Bolt consolidation.

## Production-readiness roadmap (third pass, 2026-10-13 21:00 EDT)

Principles: provider-neutral, free-tier only, no secrets in code, every phase reversible, fail-closed by default. Measured baseline: line coverage 77% overall, but `index.ts` (the production entrypoint) 0%, `grant-tools` 23%, `mcp.ts` 46%, `store.ts` 52%, `db-ready` 29%.

| # | Phase | Goal | Deliverables | Exit criteria | Risk |
|---|---|---|---|---|---|
| 1 | Green truth | CI that can be trusted | Pinned actions (#197); fix or disconnect Cloudflare Workers Builds; required checks list | `main` all green for 7 days | Low |
| 2 | One wiring (in progress: #211) | Tests exercise exactly what production runs | `index.ts` reduced to `createConduitApp(loadOptions(env)).listen()`; move host/origin/CORS, `/events`, `CONDUIT_TOKEN` into the factory; reconcile `legacy: "stateless"` drift | `index.ts` < 30 lines; http-e2e covers prod wiring; coverage of wiring ≥ 85% | Medium |
| 3 | Lockdown by construction (in progress: #206 fail-closed, #209 trust proxy) | Prod safety independent of a single env var | `isProductionRuntime()` (#206) extended to the capability-required default after checking live env; startup refuses dev auth modes on prod; `trust proxy` configured so per-IP limits are real | Startup test matrix: prod markers × dev flags all refuse | Medium |
| 4 | Public surface minimised | Nothing unauthenticated does work on others' behalf | `/diagnostics` cached (#208) then moved behind read scope with a public `/health`-only summary; `/status` counts behind auth; typed tool inputs (#207) | Unauthenticated routes: `/`, `/health`, `/ready`, OAuth metadata only | Low |
| 5 | Transport security | Encrypted and verified DB connections | Postgres TLS verify on by default (#155/#162 merged as one), explicit `DATABASE_SSL_*` docs, `/ready` reports TLS mode | Live `/ready` green with verification on | Medium (outage if CA wrong) |
| 6 | Signed, scoped cursors | Cursors can't be forged or replayed across queries | HMAC-signed keyset cursors with key rotation (from #162), consolidated Bolt perf (#204) | Tampered/foreign cursors rejected in tests; fuzz test on codec | Low |
| 7 | Capability gates per tool | Least privilege for every write and external call | Per-tool capability map (read/write/admin/external), deny-by-default for `integration_call`/`mcp_bridge_call`, grants audited | Contract test asserts every tool declares a gate | Medium |
| 8 | Persistence & ordered migrations | Safe, reviewable schema evolution | Versioned forward-only migrations (#120) with checksum table, dry-run mode, inline DDL removed from `store.ts` | Fresh + upgrade-from-0.8.0 tested on CI Postgres; no destructive DDL without flag | Medium |
| 9 | Contract & integration tests | Behavior pinned at the protocol edge | MCP contract snapshots (tool list + schemas), HTTP e2e over real wiring, Postgres parity suite, coverage gate | Coverage ≥ 80% on auth/store/mcp; schema drift fails CI | Low |
| 10 | Operable release | Repeatable, observable 0.9.0 | Structured logs with request ids + redaction, graceful SSE drain (#119), changelog, tag, rollback runbook; device acceptance claimed only with real CHR-55 evidence | Tagged 0.9.0, live-smoke green, rollback rehearsed | Medium |

Fifth-pass progress: #212 capabilities default (phase 3), #213 honest Workers handler (phase 4), #214 coverage gate (phase 9), #216 DB/discovery timeouts (phase 10). New for phase 8: consolidate the four pg pools into one shared pool. New for phase 4: an SSE connection cap and a shared poller.

Fourth-pass changes: phase 3 now also covers moving `CONDUIT_CAPABILITIES_REQUIRED` to `isProductionRuntime()`; phase 4 adds removing or making honest the Workers `fetchHandler` stub (fake `/status` and `/ready`); phase 9 adds a coverage gate now that `index.ts` is trivial.

Assumptions challenged:
- "Tests are green, so prod is covered": false; the production entrypoint is untested (0%).
- "NODE_ENV=production protects us": a single forgotten variable re-enables dev auth; fixed for auth in #206.
- "Rate limits are per client": without `trust proxy`, `req.ip` is likely the proxy, so limits are shared by everyone.
- "Cloudflare Workers is a deploy target": `index.ts` exports a Workers `fetchHandler` stub that serves fake `/status` and `/ready` (always ready, memory). Either commit to it or remove it; today it only produces a red check and a misleading surface.
- "Portfolio posture belongs here": it contradicts the README's non-goals; consider moving it to a separate ops repo.

---
Previous portfolio phases (kept for history):

## Phase 1 — Owner gate stays external
Do not invent or store SUPABASE_SERVICE_ROLE_KEY. Exit: live ready body remains owner-blocked; posture parser rejects any other classification.

## Phase 2 — Alias and stranger classification stay strict
404 and unexpected 200 occupants are never the gate. Exit: tests reject treating them as owner action, device recorded, or production ready.

## Phase 3 — Device fence immutable
claimDeviceAcceptance() rejects. Exit: health body keeps deviceAcceptance=not_recorded and acceptanceGate=CHR-55.

## Phase 4 — CHR-55 remains the only device gate
Simulator, CI, or workers.dev 200 is not acceptance. Exit: Linear CHR-55 open until archive IPA installed and validated on iPhone 16e.

## Phase 5 — Conversation and Memory budget stay
Bounded windows and on-device embeddings continue. Exit: AppTests green; no unbounded history leakage.

## Phase 6 — Gateway contract and free-tier stay
No paid Workers bindings (KV/R2/D1/Queues). Exit: wrangler.toml clean.

## Phase 7 — Hygiene prune executed
One roadmap file. No hourly audit artifacts. Held PRs not merged without verification. Archived Quicksilver remains non-product. Superseded docs-refresh PRs closed. Audit note mirrored.

## Phase 8 — Resonance control plane waits on stamp
No second client or iOS Resonance surface until live Netlify ready body carries contract stamp and owner key is set.

## Phase 9 — Privacy and logging stay strict
Privacy manifest enforced. Gateway logs metadata only. Exit: no request/response body logging.

## Phase 10 — Cross-plane acceptance proof
Single probe covers Conduit ready, Resonance ready (stamped), and real device archive evidence. Exit: production verdict accepted. Fixture or classifier test is insufficient.

Binding constraints: Resonance owner secret + CHR-55 device archive. Neither is closed by simulator or classifier.

## Innovation Track (advanced — no gates violated)
1. Pure PortfolioPosture classifier (scripts/portfolio-posture.mjs) — unit-tested, no secrets. Fail-closed. Explicitly rejects incomplete_ready.
2. portfolio-probe.sh: structured JSON, cold-start handling, --json, fail-closed. Live-verified at 14:01Z.
3. Hygiene prune: outdated docs-refresh PRs presented for close this session (interactive).
4. Adversarial review of lattice PRs (#242/#154/#187) — keep open until verified.
5. Bolt performance opts (#188/#191/#194/#195/#196) reviewed — low risk, tests claimed green; merge candidates after re-verify.
6. Postcss Dependabot in Resonance: lockfile bump to >=8.5.23 next (no secret, no deploy). High/medium path traversal residual (GHSA-r28c-9q8g-f849 / GHSA-fxqj-rqcc-2cmp).
7. Cross-repo consistency: this evidence block is canonical; mirrored this session.
8. Chamber dissonance (#157) held pending no-gate confirmation.
9. On-device Nexus capability list diagnostic (post Phase 8 only).
10. Fresh 10:00 EDT probe confirms identical fail-closed posture. No regression.

Audit note: Full audit, hardening, stabilization, hygiene, and prune pass completed 10:00 EDT. Fresh probes confirm fail-closed posture. Innovation: roadmap refreshed with live evidence; classifier and probe tools hold; superseded PRs presented for close; durable AUDIT-2026-10-13.md added. No secret invention. No device claim. Stabilization holds. Highest-value next: address postcss lockfile (high severity path traversal), re-verify Bolt opts for merge, CHR-55 device archive remains sole hard gate.
