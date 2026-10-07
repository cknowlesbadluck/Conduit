# Portfolio 10-phase roadmap — 2026-10-06 23:00 EDT

Live probes at 2026-10-07T03:01:29Z. No secrets invented. A classifier is not production proof.

Evidence:
- Resonance `GET https://resonancenexus.netlify.app/api/ready` returned **503**. Body omitted `ownerActionRequired` and `contractRevision`. `missingRequired` is exactly `SUPABASE_SERVICE_ROLE_KEY`. Auth mode required and ok. Persistence and GitHub adapter not configured. `/api/health` returned 200.
- Source on main already emits the contract fields. Public host is deploy-lagged. `#150` is the only ready-body pin. CI on `#150` is green; `github-advanced-security` failed. Do not merge it while that check is red, and do not open a third ready-body change.
- `https://resonancenexus.vercel.app` returned **404** `DEPLOYMENT_NOT_FOUND`. That is alias absence, not the owner gate.
- Conduit `GET /health` and `GET /ready` both returned 200, `version=0.8.0`, `contractRevision=2026-10-03-ready-surface`, persistence postgres. Diagnostics ok. Bound agent `grok`, no binding conflict. `activity_prune` removed 0.
- QuicksilverV1 main is `182d1334`. Open: `#239` roadmap, `#238` degrade planner, `#209` dependabot checkout 4 to 7. CHR-55 device HG on iPhone 16e remains the product gate. Simulator CI is not that gate.
- Legacy `cknowlesbadluck/Quicksilver` is not the product. Archive still returns 403 to this token. `cknowlesbadluck/mcp` is already archived.
- Entropy after this pass: Resonance 3 open, Conduit 7 open, QuicksilverV1 3 open. Orphan branches deleted: Conduit bolt micro-opts and `harden/admission-collapse-1000`; Resonance counsel/audit-fixes, counsel/ios-app-target, custom-capability-catalog, admission-collapse; QuicksilverV1 admission-collapse. Keep red: Conduit `#119` `#120`. Do not merge `#155` `#162` until the Render TLS env is set.
- Host posture classifier landed on `#183` (`src/host-posture.ts`). Local tests 5/5. It does not fetch URLs and does not store secrets.

## Phase 1 — Owner gate

Set `SUPABASE_SERVICE_ROLE_KEY` on Netlify site `resonancenexus` only. Do not invent it. Exit: public `GET /api/ready` is 200 and `ownerActionRequired` is false.

## Phase 2 — Kill the split-brain deploy

`#150` stays the only ready-body pin. Exit: public Netlify body contains `contractRevision` and `ownerActionRequired`. A green Vercel alias does not close this phase. `resonancenexus.vercel.app` stays classified `alias_absent` until an owner points it somewhere real or deletes the alias.

## Phase 3 — Admission gate

Ship the project-agnostic `work_admission` classifier on Conduit `#183`. Exit: required CI green, tool does not mutate records, and no new witness PR is opened while an invariant is already open.

## Phase 4 — Entropy prune

Orphan branches from this pass are gone. Exit: open PR count does not rise, and no keep-red PR is closed. `#119` `#120` `#155` `#162` stay open.

## Phase 5 — Quicksilver device gate

Do not treat simulator CI as release. Exit: CHR-55 archive IPA installed on iPhone 16e, or an explicit owner waiver. `#209` rebases only after checkout 7 is proven on the iOS job.

## Phase 6 — One degrade planner

`#151` / `#182` / `#238` are the same invariant. Merge one after CI, close the duplicates. Exit: one degrade-planner implementation on each default branch, not three drifting copies.

## Phase 7 — Chamber fail-closed stays

No new provider. Execution stays denied when a capability is not executable. Exit: chamber tests stay red-free on Resonance main.

## Phase 8 — One iOS target

Do not start a second Resonance client. Diverged iOS branches were deleted this pass. Exit: a single app target rebuilt on current main, or no iOS app PR.

## Phase 9 — Grants stay deny-by-default

Conduit resource records hold no secrets. TLS verify stays unmerged until Render env is set. Exit: grant tests green; `#155` and `#162` still closed-to-merge.

## Phase 10 — Cross-plane acceptance

One probe covers Conduit ready, public Resonance ready, and Quicksilver device posture. Exit: all three green on their real hosts. The host-posture unit test is not that proof.

Binding constraint: owner secret on Netlify, plus a deploy that actually reaches that host. Agent work cannot close Phase 1.
