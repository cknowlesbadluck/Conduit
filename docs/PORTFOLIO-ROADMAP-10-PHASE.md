# Portfolio 10-phase roadmap — 2026-10-09 21:00 EDT

Live probes at ~2026-10-10T01:01Z. No secrets invented. Classifier tests are not production proof. This pass did not merge #187.

Evidence:
- `GET /health` and `GET /ready` on `https://conduit-feco.onrender.com` both returned 200, `version=0.8.0`, `contractRevision=2026-10-03-ready-surface`, ready `persistence=postgres`.
- Resonance public ready is 503 missing exactly `SUPABASE_SERVICE_ROLE_KEY` and omits the contract stamp. Vercel alias is 404 `DEPLOYMENT_NOT_FOUND` or stranger_occupant.
- Quicksilver device acceptance is not recorded on gateway health. CHR-55 remains open.
- Held: #119 and #120 draft red. #155 do not merge until Render TLS env is set. #162 same hold. #188 CI verify is green; Workers Builds failed. #187 says do not merge.
- Activity prune this pass removed 0 rows.

## Phase 1 — Owner gate is not Conduit's
Do not invent the Resonance service-role key. Exit: Conduit diagnostics still refuse to store it.

## Phase 2 — Contract stay
Do not open another health-stamp PR. Exit: live health and ready still share `2026-10-03-ready-surface`.

## Phase 3 — TLS hold
#155 and #162 stay unmerged until the Render Postgres TLS env is set. Exit: a probe after the env change, not a fixture.

## Phase 4 — Draft red stays draft
#119 and #120 are not merge candidates. Exit: they remain draft.

## Phase 5 — Probe verdict
`classifyProbe` names alias_absent, owner_gate, deploy_lag, and device_not_recorded. `productionProof` is always false. Exit: unit tests green.

## Phase 6 — Pagination micro-opt
#188 may merge only after the Workers Builds failure is explained or shown to be unrelated. Exit: verify and postgres-coordination stay green.

## Phase 7 — Hygiene prune
No hourly audit files. One roadmap file. Do not stack another lattice PR on top of #187.

## Phase 8 — Grants stay deny-by-default
A resource record is not a grant. Exit: grant tests green and no resource record holds a secret.

## Phase 9 — Bridge stays deny-by-default
`integration_call` and `mcp_bridge_call` stay least-privilege. Exit: no new provider hardcoded into core identity.

## Phase 10 — Cross-plane acceptance
One probe covers Conduit health, Conduit ready, and the public Resonance ready body. Exit: production verdict accepted. A fixture test is not that proof.

Binding constraint for the portfolio is the Resonance owner secret. Conduit itself is ready at the coordination surface and is not production-proven for TLS or grants.

Innovation notes (this pass):
- Strengthen PortfolioPosture classifier with stranger_occupant and inactive Supabase signals.
- Prepare HMAC cursor once CONDUIT_CURSOR_SECRET ready (see #162).
- Device validation script for CHR-55 real IPA remains external to Conduit.
