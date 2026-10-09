# Portfolio 10-phase roadmap — 2026-10-09 09:00 EDT

Live probes at 2026-10-09T13:02:05Z. No secrets invented. A classifier test is not production proof. This pass did not merge #187.

Evidence:
- `GET /health` and `GET /ready` on `https://conduit-feco.onrender.com` both returned 200, version `0.8.0`, contractRevision `2026-10-03-ready-surface`, persistence `postgres`.
- Resonance public ready is 503 missing exactly `SUPABASE_SERVICE_ROLE_KEY` and omits the contract stamp. Vercel alias is 404 `DEPLOYMENT_NOT_FOUND`.
- QuicksilverV1 #243 is on main. Device acceptance is still not recorded. CHR-55 remains open.
- Held: #119 and #120 draft red. #155 and #162 unmerged until Render TLS env is set. #188 is an automation hold. #187 says do not merge. `release/0.8.0` is hold-not-delete.

## Phase 1 — Owner gate is not Conduit's
Do not invent the Resonance service-role key. Exit: admission clock stays at phase 1 while the public ready body lists that key.

## Phase 2 — Contract stay
Do not open another health-stamp PR. Exit: live health and ready still share `2026-10-03-ready-surface`.

## Phase 3 — TLS hold
#155 and #162 stay unmerged until the Render Postgres TLS env is set. Exit: a probe after the env change, not a fixture.

## Phase 4 — Draft red stays draft
#119 and #120 are not merge candidates. Exit: they remain draft.

## Phase 5 — Admission clock
`admit` holds phase 1 on an owner gate, classifies alias absence separately, and never records device acceptance. Exit: `admission-clock` tests green. `productionProof` stays false.

## Phase 6 — Pagination micro-opt
#188 may merge only after Workers Builds is green or shown unrelated. Exit: verify and postgres-coordination stay green.

## Phase 7 — Hygiene prune
No hourly audit files. One roadmap file. Closed heads with no open pull may be deleted. Keep-red heads and `release/0.8.0` may not.

## Phase 8 — Grants stay deny-by-default
A resource record is not a grant. Exit: grant tests green and no resource record holds a secret.

## Phase 9 — Bridge stays deny-by-default
`integration_call` and `mcp_bridge_call` stay least-privilege. Exit: no product name hardcoded into core identity.

## Phase 10 — Cross-plane acceptance
One probe covers Conduit health, Conduit ready, and the public Resonance ready body. Exit: production verdict accepted. A fixture test is not that proof.

Binding constraint for the portfolio is the Resonance owner secret. Conduit itself is ready at the coordination surface and is not production-proven for TLS or grants.
