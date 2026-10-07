# Portfolio 10-phase roadmap — 2026-10-07 05:00 EDT

Live probes at 2026-10-07T09:01:56Z. No secrets invented. A classifier is not production proof.

Evidence:
- Conduit `GET /health` and `GET /ready` returned 200, version `0.8.0`, `contractRevision` `2026-10-03-ready-surface`, persistence `postgres`.
- Resonance public `GET /api/ready` returned 503. `missingRequired` is exactly `SUPABASE_SERVICE_ROLE_KEY`. Body omitted `ownerActionRequired` and `contractRevision`. `GET /api/health` returned 200.
- `resonancenexus.vercel.app` returned 404 `DEPLOYMENT_NOT_FOUND`. That is alias absence, not the owner gate.
- Legacy `cknowlesbadluck/Quicksilver` remains unarchived. Last push 2026-09-29. Archive attempts return 403 on this token.
- `mcp` is already archived. Open-PR inventory had no orphan branches outside open records and `release/0.8.0`.
- Saturation governor says `close_noise` for Conduit `#184` (Bolt sort) and `openNewPullRequest=false`. `#119` `#120` `#155` `#162` stay unmerged.

## Phase 1 — Owner gate

Set `SUPABASE_SERVICE_ROLE_KEY` on Netlify site `resonancenexus` only. Do not invent it. Exit: public `GET /api/ready` is 200 and `ownerActionRequired` is false.

## Phase 2 — Single ready-body pin

Resonance `#150` is the only ready-body pin. Exit: public body contains `contractRevision` and `ownerActionRequired`, and required checks are green before merge.

## Phase 3 — Coordination host stamp

Done on the live host. Exit already met: `/health` and `/ready` share `2026-10-03-ready-surface` and ready names `postgres`.

## Phase 4 — Saturation governor

`src/saturation-governor.ts` on Conduit `#183`. Exit: while Phase 1 is blocked, the next audit refreshes an open roadmap record and closes bolt noise. It does not open another pull request.

## Phase 5 — Alias classification

Done for the current alias. Exit: 404 `DEPLOYMENT_NOT_FOUND` stays `alias_absent`. Do not treat it as a deploy task.

## Phase 6 — Keep-red fence

`#119` `#120` `#155` `#162` stay unmerged. Exit: none of those numbers land on main.

## Phase 7 — Hygiene prune

No hourly audit file. One roadmap file per repo. Bolt `#184` closed as stabilization noise. Archive of legacy Quicksilver is an owner action; this token gets 403. Exit: orphan branches that do not back an open PR are gone, and `activity_prune` has run.

## Phase 8 — Device gate stays outside coordination

QuicksilverV1 device gate remains CHR-55 on iPhone 16e. Simulator CI is not that gate. `PortfolioPosture.aliasAbsent` now distinguishes a Vercel 404 from an owner gate. Exit: device HG, or an owner waiver.

## Phase 9 — Deny-by-default grants

No secrets in resource records. Bridge and integration calls stay denied without a grant. Exit: grant tests green on main.

## Phase 10 — Cross-plane acceptance

Exit: Conduit ready 200, Resonance ready 200, and a device gate that is not a unit test.

Binding constraint: owner secret on Netlify. Agent work cannot close Phase 1.
