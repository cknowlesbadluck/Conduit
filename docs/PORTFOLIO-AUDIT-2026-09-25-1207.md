# Conduit + Portfolio Audit — 2026-09-25 12:07 EDT

Live remains green. Do not merge #119/#120.

- Endpoint `https://conduit-feco.onrender.com/mcp` 0.8.0
- `/health` ok; `/ready` ready, persistence postgres
- Diagnostics: health, PRM, AS, JWKS, scope parity, CIMD/DCR all pass
- Bound agent `grok`, bindingConflict=false
- Main after #122 squash: `c5310f08` on prior `5c214b62` / runtime `7c3007a`
- Open drafts: #119 verify red + Workers fail; #120 postgres-coordination red + Workers fail
- Residuals: grants global; supabase adapter unconfigured; Render dashboard buildCommand historically `npm install`; stale claimed tasks owned by gemini-spark / grok-xai (not stolen)
- Extra branches: `release/0.8.0`, `docs/audit-roadmap-2026-09-25`, leftover `docs/portfolio-audit-1100`

Conduit is the only production-shaped service in the portfolio. It is not the binding constraint.
