# Portfolio 10-phase roadmap — 2026-10-06 03:00 EDT

Live probes at 2026-10-06T07:00:54Z. No secrets invented. A fixture is not production proof. Workers Builds failure is not the Render gate.

Evidence:
- Resonance `GET https://resonancenexus.netlify.app/api/ready` returned 503. Body missing exactly `SUPABASE_SERVICE_ROLE_KEY`. Omitted `ownerActionRequired` and `contractRevision`. Not proof.
- `https://resonancenexus.vercel.app/` returned 404 `DEPLOYMENT_NOT_FOUND`. Alias absence, not the owner gate.
- Conduit `GET /health` and `GET /ready` returned 200, version `0.8.0`, `contractRevision=2026-10-03-ready-surface`, persistence `postgres`.
- QuicksilverV1 `main` is `82be4b00` (M3-T21 eval harness). Simulator CI is not device HG. CHR-55 remains the product gate.
- Resonance #150 typecheck failed on an untyped `.mjs` import; high audit was postcss/tinypool. This pass types the script and overrides the patched transitive packages. Do not merge until web CI is green.
- Conduit #180 required `verify` and `postgres-coordination` were green. Workers Builds failed instantly. Not merged this pass until the redact hardening is green.

## Phase 1 — Owner gate
Set `SUPABASE_SERVICE_ROLE_KEY` on Netlify site `resonancenexus` only. Do not invent it. Do not switch hosts. Exit: public `/api/ready` is 200 and `ownerActionRequired` is false.

## Phase 2 — Deploy-lag pin
Land Resonance #150 only after web CI is green. Exit: live ready body contains `contractRevision` and `ownerActionRequired`. A Vercel 404 is not that exit.

## Phase 3 — Conduit surface stays one contract
Keep `/health` and `/ready` on the same stamp. Exit: both live bodies still share `2026-10-03-ready-surface` after the next Render deploy. Phase clock stays project-agnostic.

## Phase 4 — Quicksilver gateway stamp
Stamp gateway `/v1/health` with a contract revision. Exit: health JSON includes the stamp and no secret. Device HG is still not claimed.

## Phase 5 — Persistence proof
Blocked on Phase 1. Exit: production smoke against a real 200 body. A unit test is not that proof.

## Phase 6 — Chamber fail-closed
No new provider. Exit: existing chamber denial tests stay red-free on main.

## Phase 7 — Hygiene
No hourly audit files. Do not merge #119, #120, #155, #162, or #179. Archive `cknowlesbadluck/Quicksilver` when the token can; close/archive has been 403.

## Phase 8 — One iOS client
Do not start a second client. Exit: Resonance #134 builds or is closed. QuicksilverV1 remains the product client.

## Phase 9 — Grants and TLS
Deny-by-default. Exit: #155 and #162 stay unmerged until Render Postgres TLS env is set.

## Phase 10 — Cross-plane acceptance
One live probe covers Conduit health, Conduit ready, Resonance ready, and a device archive. Exit: owner accepts the production verdict. A classifier test is not that proof.

Binding constraint: owner secret on Netlify. Agent work cannot close Phase 1.
