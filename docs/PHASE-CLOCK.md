# Phase clock

Project-agnostic classifier for host probes and a 10-slot phase plan.

It does not name a product in code, store a secret, or treat a unit test as production proof.

`classifyHostProbe` distinguishes:

- `owner_gate` — 5xx with a missing required config name, or 2xx that still says persistence is unconfigured
- `alias_absent` — 404 or `DEPLOYMENT_NOT_FOUND`
- `contract_drift` — 2xx that omits the contract stamp
- `ready` — 2xx, stamp present, persistence configured, owner action not required

`decideMerge` refuses a keep-red pull request and a red required check. Do not merge either.

Live portfolio reading at 2026-10-06T04:01Z, passed in by the caller, not hardcoded here:

1. Owner gate — Netlify `resonancenexus` still 503, missing exactly `SUPABASE_SERVICE_ROLE_KEY`. Body omits `ownerActionRequired` and `contractRevision`.
2. Deploy lag — pin PR #150 is mergeable but web CI is red on `npm audit` (postcss/vitest). Not merged.
3. Conduit contract — `/health` and `/ready` 200, version 0.8.0, `contractRevision=2026-10-03-ready-surface`, persistence postgres.
4. Quicksilver eval — #236 squash-merged at `82be4b00`. Simulator CI is not device HG. CHR-55 remains the product gate.
5. Persistence smoke — blocked on phase 1.
6. Chamber fail-closed — stays on main; no new provider this pass.
7. Hygiene — legacy Quicksilver archive and PR close returned 403. Keep-red #119 #120 #155 #162 #179 stay open. Activity prune removed 0.
8. Single iOS target — Resonance #134 still behind, not a second client.
9. Grants — deny-by-default. TLS PRs stay unmerged until Render env is set.
10. Cross-plane acceptance — not met. A classifier test is not that proof.
