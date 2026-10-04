# Portfolio 10-phase roadmap — 2026-10-04 08:00 EDT

Live probes at 2026-10-04T12:02Z. No secrets invented. A fixture is not production proof. A Vercel alias is not the public gate.

Evidence:
- Conduit `GET /health` 200 `{"status":"ok","service":"conduit","version":"0.8.0","contractRevision":"2026-10-03-ready-surface"}`.
- Conduit `GET /ready` 200 `{"status":"ready","service":"conduit","version":"0.8.0","contractRevision":"2026-10-03-ready-surface","persistence":"postgres"}`. Surface is aligned. Phase 1 of the 2026-10-03 roadmap is done.
- Resonance `GET /api/health` 200. `GET /api/ready` 503. Body missing exactly `SUPABASE_SERVICE_ROLE_KEY`. Body omitted `ownerActionRequired` and `contractRevision`. Host `resonancenexus.netlify.app`.
- QuicksilverV1 main `e78be61e` is M3-T9 history budget. Device HG (CHR-55) is unproven. Simulator CI is not acceptance.
- Open pulls: QuicksilverV1 #223 and #209; Resonance #132 #133 #134; Conduit #119 #120 #155 #162 #164 #168 #172 #173 #174 #175. Held: #119 #120 #155. Non-held count is over the admission budget of 4.

Admission rule, encoded in `src/portfolio-admission.ts`: owner blocks outrank prune, prune outranks new scope.

## Phase 1 — Conduit surface parity

Done on the live host. Exit met: `/health` and `/ready` share `2026-10-03-ready-surface` and persistence is postgres.

## Phase 2 — Resonance owner gate

Set `SUPABASE_SERVICE_ROLE_KEY` on existing Netlify site `resonancenexus`. Do not invent it. Do not switch hosts. Exit: public `/api/ready` 200, `ownerActionRequired` absent or false, body carries the source `contractRevision`.

## Phase 3 — Entropy under budget

Close, rebase, or land. Do not open another roadmap file. Held drafts #119 #120 #155 stay unmerged. Exit: open non-held pulls across the three repos <= 4.

## Phase 4 — Quicksilver device HG

Archive IPA on iPhone 16e (CHR-55). #223 may land only with UI smoke and required jobs green. Exit: device evidence, not a simulator badge.

## Phase 5 — Collapse the classifier pile

One admission function. Retire #172 #173 #174 once this contract is on main. Exit: `admitPortfolio` is the only portfolio gate agents import.

## Phase 6 — Resonance capability plane on the proof host

Public page still shows 0 capabilities. Exit: catalog resolve works against the production 200 ready body, not a preview.

## Phase 7 — Single iOS client

#134 is the app target. Do not start a second client. Exit: #134 builds on current main, or it is closed.

## Phase 8 — Chamber evidence

Form, work, dissolve, audit intact. Exit: chamber tests green on main and one live evidence record.

## Phase 9 — Grant deny-by-default

No secret in a resource record. Exit: grant tests green and bridge calls still require a grant.

## Phase 10 — Cross-plane acceptance

One probe covers Conduit health, Conduit ready, and Resonance ready on the proof host. Exit: production verdict accepted. This document is not that proof.

Binding constraint: owner secret on Netlify, then pull entropy. Agent work cannot close Phase 2.
