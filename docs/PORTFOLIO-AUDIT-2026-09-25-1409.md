# Portfolio audit — 2026-09-25 14:09 EDT

Conduit main `469117b3`. Live `/health` 200. Live `/ready` 200 `version=0.8.0` `persistence=postgres`. Binding `grok` conflict=false.

## Open PRs

- #119 DRAFT KEEP RED — SSE admission. Do not merge.
- #120 DRAFT KEEP RED — ordered migrations. Do not merge.
- #125 keyset pagination — verify + postgres-coordination success; Workers Builds fail. Leave open. Do not merge red.

#124 closed as stale hourly docs.

## Residuals

Render dashboard buildCommand still `npm install` (no render.yaml). Free-plan single instance. Supabase adapter unconfigured. Grants global not project-scoped. Stale claimed tasks owned by other agents not stolen.

## Highest-value Conduit move

Keep production frozen. Fix or close #119/#120. Treat #125 as the next merge candidate only after required checks are green or Workers Builds is explicitly non-blocking.
