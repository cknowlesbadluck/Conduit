# Portfolio 10-phase roadmap — 2026-10-03 08:00 EDT

Live probes at 2026-10-03T12:01:16Z. No secrets invented.

Evidence:
- Resonance `GET /api/ready` 503. Missing exactly `SUPABASE_SERVICE_ROLE_KEY`. Body omitted `ownerActionRequired` and `contractRevision`. Owner gate plus deploy lag.
- Conduit `GET /health` 200 `{"status":"ok","service":"conduit"}` with no version. `GET /ready` 200 `version=0.8.0` `persistence=postgres`. Contract split, not an outage.
- #170 squash-merged at c2b83e8d. Required verify and postgres-coordination were green. Workers Builds failed instantly and is not the Render path. Live `/health` stays stale until Render redeploys. The merge is not production proof.
- QuicksilverV1 is the mobile client. Simulator CI is not device acceptance.

## Phase 1 — Owner gate
Set `SUPABASE_SERVICE_ROLE_KEY` on resonancenexus. Do not invent it. Exit: GET `/api/ready` 200 and `ownerActionRequired` is false.

## Phase 2 — Deploy lag kill
Land Resonance #147 only after CodeRabbit is cleared. Exit: live ready body contains `contractRevision`.

## Phase 3 — Conduit health parity on the host
#170 is on main. Exit: live `/health` and `/ready` both return version 0.8.0 after Render deploys c2b83e8d.

## Phase 4 — Quicksilver fail-closed witness
`PortfolioWitness` must reject a versioned `/ready` paired with an unversioned `/health`. Exit: witness tests green. Device build still not claimed.

## Phase 5 — Persistence proof
After Phase 1, run production smoke against the real 200 body. Exit: smoke passes on the production host.

## Phase 6 — Chamber fail-closed stays
No new provider. Execution remains denied when a capability is not executable. Exit: existing chamber tests stay red-free.

## Phase 7 — Hygiene prune
No hourly audit files. One roadmap file per repo. Do not merge #119, #120, or #155. Bolt #161, #165, #169 closed as overlapping.

## Phase 8 — iOS cockpit only after the app target is green
Do not start a second client. Exit: Resonance #134 builds, or it is closed.

## Phase 9 — Grant and bridge audit
Grants stay deny-by-default. Exit: grant tests green and no resource record holds a secret.

## Phase 10 — Cross-plane acceptance
One probe covers Conduit health, Conduit ready, and Resonance ready. Exit: production verdict accepted. A fixture test is not that proof.

Binding constraint: owner secret on Netlify. Agent work cannot close Phase 1.
