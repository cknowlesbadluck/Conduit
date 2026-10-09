# Portfolio 10-phase roadmap — 2026-10-09 01:00 EDT

Live probes at 2026-10-09T05:01Z. No secrets invented. A classifier is not production proof. This file is the in-place roadmap. Do not add hourly audit files. Do not open a new witness family.

Evidence:
- Conduit `GET /health` and `GET /ready` returned 200. `version=0.8.0`, `contractRevision=2026-10-03-ready-surface`, persistence `postgres`. Diagnostics: health, protected resource, authorization server, JWKS, and scope parity all ok. Bound agent `grok`, no binding conflict.
- Resonance `GET https://resonancenexus.netlify.app/api/ready` returned 503. `missingRequired` is exactly `SUPABASE_SERVICE_ROLE_KEY`. Body omitted `ownerActionRequired` and `contractRevision`. `GET /api/health` returned 200.
- Supabase projects `Resonance` (`lfdynzionafcpddqipqc`, us-west-2), `Quicksilver: Mercurial intelligence` (`lmgcogfafgmrtqxsepfq`, ca-central-1), and `WhereamI?` (`fqxcyeeakfakzdknvloe`, us-east-1) are `INACTIVE`. A paused project is an owner gate distinct from the missing key. Setting the key against a paused project is not persistence proof.
- `https://resonancenexus.vercel.app/` returned 404 `DEPLOYMENT_NOT_FOUND`. Classify as `alias_absent`, not an owner gate. Vercel project list is empty.
- Legacy `cknowlesbadluck/Quicksilver` is archived. Do not retry archive.
- Open non-archived pulls: Conduit `#187` plus keep-red `#119` `#120` `#155` `#162`; Resonance `#154`; QuicksilverV1 `#242` `#241` `#209`. No new witness pull.
- Lattice revision `2026-10-09-paused-project`. Local tests 5/5. Do not merge Conduit `#187` while Workers Builds is red. Do not merge Resonance `#154` while github-advanced-security is red. QuicksilverV1 `#242` checks were green; it stays open until the portfolio merge rule is explicit.
- `activity_prune` removed 0. `nastynights` is a live Netlify site and is out of this portfolio.

## Phase 0 — Owner gate

Unpause the Resonance Supabase project, then set `SUPABASE_SERVICE_ROLE_KEY` on Netlify site `resonancenexus` only. Do not invent the key. Exit: public `GET /api/ready` is 200, persistence is configured, and the project is not paused. Agent work cannot close this phase.

## Phase 1 — Entropy collapse

Exit: discretionary open pulls per active repo are at most 2. Keep-red pulls do not count. Archived repos do not count. This pass does not close `#241` or `#209` and does not merge keep-red. QuicksilverV1 still has 3 discretionary pulls, so the breach remains after Phase 0.

## Phase 2 — Ready parity

After Phase 0, public Netlify ready body matches the repository contract revision. A Vercel alias success does not count.

## Phase 3 — Persistence proof

Apply `supabase/migrations` on the unpaused Resonance project. Exit: production smoke passes against `resonancenexus`, not a side alias.

## Phase 4 — Idempotent execution

Duplicate requests do not double-execute. Exit: Idempotency-Key covered by a production-shaped test on main.

## Phase 5 — Adapter substitution

One real adapter vertical slice, plus a second provider behind the same capability model. Exit: substitution test green without Conduit becoming Resonance-specific.

## Phase 6 — Chamber lifecycle

Form, work, dissolve, audit intact. Exit: chamber tests green and fail-closed when a capability is not executable.

## Phase 7 — iOS peer contract

One capability model on web and iOS. Exit: no dual model on main. Do not revive closed cockpit pulls.

## Phase 8 — Device acceptance

iPhone 16e human gate. Simulator CI is not this gate. `#241` stays open until that gate is recorded. Mercury gateway deploy remains owner-only.

## Phase 9 — Release hardening

SideStore IPA evidence, privacy manifest, Postgres TLS only after the owner sets Render env. Exit: keep-red `#155` and `#162` either merged against a prepared env or still explicitly unmerged.

Binding constraint: paused Supabase plus missing Netlify key. Entropy fence revision `2026-10-09-paused-project` does not pretend otherwise.
