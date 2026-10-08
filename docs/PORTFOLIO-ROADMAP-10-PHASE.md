# Portfolio 10-phase roadmap — 2026-10-08 07:00 EDT

Live probes at 2026-10-08T11:01:18Z. No secrets invented. A ledger is not production proof. This pass refreshes the entropy-governor branch in place. No new witness pull.

Evidence:
- Conduit `GET /health` and `GET /ready` returned 200, `version=0.8.0`, `contractRevision=2026-10-03-ready-surface`, ready `persistence=postgres`. Diagnostics ok. Bound agent `grok`, no binding conflict.
- Resonance `GET https://resonancenexus.netlify.app/api/ready` returned 503. `missingRequired` is exactly `["SUPABASE_SERVICE_ROLE_KEY"]`. Body omitted `ownerActionRequired` and `contractRevision`.
- `https://resonancenexus.vercel.app` returned 404 `DEPLOYMENT_NOT_FOUND`. Classified `alias_absent`.
- `activity_prune` removed 0. Legacy `cknowlesbadluck/Quicksilver` archive remains owner-only when the API returns 403. `cknowlesbadluck/mcp` is already archived.
- Open non-keep-red Conduit pulls: #180, #182, #183, #185, #186. Keep-red and unmerged: #119, #120, #155, #162.
- Bolt #186 is pagination micro-noise. Close it. Do not merge keep-red.

## Phase 1 — Owner gate
Set `SUPABASE_SERVICE_ROLE_KEY` on Netlify site `resonancenexus` only. Do not invent it. Exit: public `GET /api/ready` is 200 and the body still omits `ownerActionRequired`.

## Phase 2 — Deploy-lag kill
A Vercel alias 404 is not the gate. Exit: canonical Netlify ready body contains `contractRevision` after the owner key and a proven deploy.

## Phase 3 — Entropy governor
`entropy-governor` refuses a new witness pull when two witness pulls are open, and refuses keep-red numbers. Exit: governor tests green on #185. Do not open a fourth roadmap-only pull.

## Phase 4 — Collapse unmerged planners
#180, #182, #183 stay open until required checks are green, then one squash or an explicit close. Exit: no red required CI merged.

## Phase 5 — Quicksilver device fence
Simulator CI is not device acceptance. Exit: a recorded hardware run on iPhone 16e.

## Phase 6 — Chamber / gateway fail-closed
No new provider. Execution stays denied when a capability is not executable. Exit: fail-closed tests stay red-free on main.

## Phase 7 — Hygiene prune
Delete branches whose sha equals default, and hygiene fences with no open pull. Close Bolt noise. One roadmap file. Archive legacy Quicksilver if the token allows.

## Phase 8 — Single iOS peer
Do not start a second client. Exit: one iOS target on the Nexus capability model, after Phase 1.

## Phase 9 — Grant and TLS stay deny-by-default
#155 and #162 stay unmerged until Render TLS env is set. Exit: no resource record holds a secret.

## Phase 10 — Cross-plane acceptance
One probe covers Conduit ready, Resonance ready 200, and a Quicksilver device archive. Exit: all three green on production. Unit tests are not that proof.

Binding constraint: owner secret on Netlify, then device HG. Agent work cannot close Phase 1.
