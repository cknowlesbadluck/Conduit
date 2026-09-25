# Conduit / portfolio audit — 2026-09-25 15:07 EDT

## Live
- `https://conduit-feco.onrender.com/health` 200
- `/ready` 200 version 0.8.0 persistence postgres
- diagnostics: health, PRM, AS, JWKS, scope parity, CIMD/DCR all ok
- boundAgentId=grok bindingConflict=false

## Main
- `55bf52af` after squash-merge of #126 (14:09 docs).
- Runtime is stable. No production-breaking defect found this hour.

## Open PRs after this hour
- #119 DRAFT KEEP RED — SSE admission. Do not merge.
- #120 DRAFT KEEP RED — ordered migrations (runtime no longer auto-DDL). Do not merge until migrate is production-wired.
- #125 keyset pagination — verify + postgres green; Cloudflare Workers Builds fail. Leave open.

## Residuals (non-breaking)
- No `render.yaml`; dashboard buildCommand historically `npm install && npm run build`.
- Free-plan single instance.
- Supabase adapter unconfigured.
- Grants are global, not project-scoped.
- Stale claimed orchestration tasks owned by gemini-spark / grok-xai since 2026-09-23 — not stolen.
- Connector has no delete-branch tool; docs/* stale branches remain.
