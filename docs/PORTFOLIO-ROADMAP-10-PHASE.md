# Portfolio 10-phase roadmap — 2026-10-09 03:00 EDT

Live probes at 2026-10-09T07:01Z. No secrets invented. A classifier is not production proof. This file is the in-place roadmap. Do not add hourly audit files. Do not open a new witness family.

Evidence:
- Conduit `GET /health` and `GET /ready` returned 200. `version=0.8.0`, `contractRevision=2026-10-03-ready-surface`, persistence `postgres`. Diagnostics: health, protected resource, authorization server, JWKS, and scope parity all ok. Bound agent `grok`, no binding conflict.
- Resonance `GET https://resonancenexus.netlify.app/api/ready` returned 503. `missingRequired` is exactly `SUPABASE_SERVICE_ROLE_KEY`. Body omitted `ownerActionRequired` and `contractRevision`.
- Supabase projects Resonance, Quicksilver, and WhereamI were `INACTIVE` at 01:00 EDT. A paused project is an owner gate distinct from the missing key. This pass did not re-list Supabase; the pause stands until the owner unpauses.
- `https://resonancenexus.vercel.app/` returned 404 `DEPLOYMENT_NOT_FOUND`. Classify as `alias_absent`, not an owner gate.
- Legacy `cknowlesbadluck/Quicksilver` is archived. Do not retry archive.
- QuicksilverV1 `#241` squash-merged at `83f13504`. That is `landed_unverified`. It is not an open pull and it is not iPhone 16e acceptance.
- Open pulls: Conduit `#187` plus keep-red `#119` `#120` `#155` `#162`; Resonance `#154`; QuicksilverV1 `#242` `#209`. Discretionary counts are 1, 1, and 2. Budget is 2. Entropy breach is closed. `#209` stays open. Keep-red stays unmerged.
- Conduit `#187` Workers Builds is red. Resonance `#154` github-advanced-security is red. QuicksilverV1 `#242` required jobs were green. Do not merge any of them this pass.
- `activity_prune` removed 0.

## Phase 0 — Owner gate

Unpause the Resonance Supabase project, then set `SUPABASE_SERVICE_ROLE_KEY` on Netlify site `resonancenexus` only. Do not invent the key. Exit: public `GET /api/ready` is 200, persistence is configured, and the project is not paused. Agent work cannot close this phase.

## Phase 1 — Entropy collapse

Exit: discretionary open pulls per active repo are at most 2. Met on the 03:00 count. Keep-red does not count. Do not treat the count as permission to merge red required checks.

## Phase 2 — Ready parity

After Phase 0, public Netlify ready body matches the repository contract revision. A Vercel alias success does not count.

## Phase 3 — Persistence proof

Apply `supabase/migrations` on the unpaused Resonance project. Exit: production smoke passes against `resonancenexus`, not a side alias. A key set against a paused project is not this exit.

## Phase 4 — Idempotent execution

Duplicate requests do not double-execute. Exit: Idempotency-Key covered by a production-shaped test on main and a live replay that does not double-write.

## Phase 5 — Adapter substitution

One real adapter vertical slice, plus a second provider behind the same capability model. Exit: substitution test green without Conduit becoming Resonance-specific.

## Phase 6 — Chamber lifecycle

Form, work, dissolve, audit intact. Exit: chamber tests green and fail-closed when a capability is not executable. Durable chamber evidence waits on Phase 3.

## Phase 7 — iOS peer contract

One capability model on web and iOS. Exit: no dual model on main. Do not revive closed cockpit pulls.

## Phase 8 — Device acceptance

`#241` is on main and remains `landed_unverified`. Exit: owner records the iPhone 16e human gate. Simulator CI is not this gate. Mercury gateway deploy remains owner-only.

## Phase 9 — Release hardening

SideStore IPA evidence, privacy manifest, Postgres TLS only after the owner sets Render env. Exit: keep-red `#155` and `#162` either merged against a prepared env or still explicitly unmerged.

Binding constraint: paused Supabase plus missing Netlify key. Lattice revision `2026-10-09-landed-fence` does not pretend otherwise.
