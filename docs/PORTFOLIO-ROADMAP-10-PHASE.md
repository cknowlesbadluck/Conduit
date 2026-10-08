# Portfolio 10-phase roadmap — 2026-10-08 14:00 EDT

Live probes at 2026-10-08T18:01:50Z. No secrets invented. A classifier is not production proof.

Evidence:
- Conduit `GET /health` and `GET /ready` returned 200, version `0.8.0`, `contractRevision` `2026-10-03-ready-surface`, persistence `postgres`.
- Resonance `GET https://resonancenexus.netlify.app/api/ready` returned 503. `missingRequired` is exactly `SUPABASE_SERVICE_ROLE_KEY`. Body omits `ownerActionRequired` and `contractRevision`. `authModeOk` is true.
- `https://resonancenexus.vercel.app/` returned 404 `DEPLOYMENT_NOT_FOUND`. Classified `alias_absent`, not an owner gate.
- Lattice pull requests remain open and unmerged: Conduit #187, Resonance #154, QuicksilverV1 #242. Host posture pin refreshed in place. No new witness opened.
- Do not merge Conduit #119, #120, #155, #162.
- Legacy `cknowlesbadluck/Quicksilver` archive is owner-only if the token returns 403.
- `activity_prune` removed 0.

## Phase 0 — Owner gate

Set `SUPABASE_SERVICE_ROLE_KEY` on Netlify site `resonancenexus` only. Do not invent it. Do not switch hosts. Exit: public `GET /api/ready` is 200.

## Phase 1 — Entropy collapse

Open pull requests already exceed the lattice budget of 2. Collapse superseded witnesses only after the owner gate closes, or close them if they are proven duplicates. Keep-red TLS drafts stay open and unmerged. Exit: each active repo has at most 2 open pull requests, keep-red excluded from the merge queue.

## Phase 2 — Ready parity

Public Netlify body must carry the same contract revision the code claims. A Vercel production status does not close this gate. Exit: public ready body contains `contractRevision` and `ownerActionRequired` is false.

## Phase 3 — Persistence proof

Run production smoke against the real 200 body on `resonancenexus`. Exit: smoke passes on that host, not on a Vercel alias.

## Phase 4 — Idempotent execution

Duplicate requests never double-execute. Exit: Idempotency-Key test is green on main, not only on a branch.

## Phase 5 — Adapter substitution

One capability domain model, a second provider behind the same contract. Exit: swapping the adapter does not change the caller.

## Phase 6 — Chamber lifecycle

Form, work, dissolve, audit intact. Exit: chamber scenario green on main.

## Phase 7 — One iOS peer contract

No second client. QuicksilverV1 is the mobile surface. Exit: one capability model on web and iOS.

## Phase 8 — Device acceptance

Human gate on iPhone 16e. Simulator CI is not acceptance. Exit: Sanctum destinations exercised from an installed IPA.

## Phase 9 — Release hardening

TLS verification only after the owner env is set. Privacy manifest and SideStore evidence. Exit: adversarial review with no red required check merged.

Binding constraint: owner secret on Netlify, plus deploy lag onto that host. Agent work cannot close Phase 0.
