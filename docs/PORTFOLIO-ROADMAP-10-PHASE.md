# Conduit 10-phase roadmap — refreshed 2026-10-13 18:00 EDT

Live evidence 2026-10-13 ~22:05Z: Conduit `/ready` 200 stamped (0.8.0, 2026-10-03-ready-surface, postgres), `/mcp` 401 unauthenticated. Resonance and Quicksilver state not re-probed from this repo. CHR-55 device acceptance remains open; nothing here claims it. Classifier tests are not production proof.
See docs/AUDIT-2026-10-13.md for findings. Open audit PRs: #197 CI hardening, #198 deps, #199 roadmap, #203 cold_start + cross-plane, #204 Bolt consolidation.

1. **CI truth** — pinned actions/least privilege (#197); resolve or disconnect Cloudflare Workers Builds. Exit: main fully green. Risk: low.
2. **Backlog prune** — land #204, close the five Bolt PRs, decide #187/#190/#193 conflicts and stale branches (#202). Exit: <6 open PRs. Risk: low.
3. **Posture fail-closed** — cold_start/gateway classification, cross-plane consistency (#203). Exit: tests cover every posture. Risk: low.
4. **Single entrypoint** — make `index.ts` use `app-factory.ts`. Exit: one route/auth wiring, e2e tests hit it. Risk: medium.
5. **DB TLS** — verify certs by default (#155/#162, #201). Exit: prod `/ready` green with verification on. Risk: medium (outage if env wrong).
6. **Migrations** — ordered migrations (#120). Exit: fresh + upgrade tested in CI Postgres. Risk: medium.
7. **Public surface** — auth or cache `/diagnostics`, trim `/status`. Exit: no unauthenticated outbound fan-out. Risk: low.
8. **SSE & shutdown** — #119 admission limits, graceful drain. Exit: load test without leaked sockets. Risk: medium.
9. **Tests & observability** — coverage reporting, structured logs with redaction. Exit: ≥80% on auth/store. Risk: low.
10. **Release 0.9.0** — changelog, tag, runbook, live-smoke gate; device acceptance only after CHR-55 has real evidence. Exit: tagged release, smoke green. Risk: medium.

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
