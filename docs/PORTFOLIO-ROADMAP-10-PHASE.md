# Conduit — 10-Phase Roadmap to a hardened 0.8+ (updated in place 2026-10-16 14:15 EDT)

Target: hardened Conduit 0.8+ → 0.9.0 with reliable grants and low PR entropy. Cross-repo view: `ROADMAP.md`. Current audit: `docs/AUDIT-2026-10-15.md`. Repos stay separate; Conduit talks to Resonance only through HTTP/MCP contracts.
Status: **[passed]** · **[in progress]** · **[blocked]** (owner action).

| # | Phase | Exit criteria | Status |
|---|---|---|---|
| 1 | Green, pinned CI | main CI + Live Smoke green; actions SHA-pinned; no owner-side red check on PRs | **[blocked]**: green ✓, pinned ✓; Cloudflare Workers Builds still red on every PR (owner: disconnect) |
| 2 | Lean code | no unreferenced modules; no TODO/FIXME in src | **[passed]** (#210, #232, #233) |
| 3 | Reliable grants | admin actions subject-matched; admins can revoke any grant (#238); expiry fails closed + refuse expired (#234); authz matrix tested (#235 ✓) | **[in progress]**: #238 and #234 open, need owner review |
| 4 | Fail-closed production | lockdown + capabilities-required independent of `NODE_ENV` (#206 → #212) | **[in progress]**: #206 changes requested; #212 conflicting |
| 5 | Bounded surface | retention/redaction/timeouts ✓; SSE cap → 503 (#217); pageLimit clamp (#231); diagnostics cache (#208) | **[in progress]** |
| 6 | Transport + data security | Postgres TLS verified by default (#155), after the owner sets the Render env | **[blocked]** (owner env) |
| 7 | Honest posture + drift | `/ready` 200 + contractRevision ✓; scheduled probe on main (#239 ✓); drift detection (#241); Workers handler honest (#213) | **[in progress]** |
| 8 | Contracts + coverage | tool-surface snapshot ✓; coverage ≥70% lines; JSON-typed schemas (#207) | **[in progress]** |
| 9 | Low entropy | ≤8 open non-draft PRs; nothing conflicting for more than 3 days; stacks rebased onto main; red drafts (#119/#120) decided | **[in progress]**: about 20 open today |
| 10 | Operable release 0.9.0 | runbook; SSE drain; tag 0.9.0; contractRevision change policy in SPEC.md; 7 days of probe drift=false | **[in progress]** |

## Merge order (grants train first)
#241 (script/test) → #231 → #238 → #234 → #206 → #212 (rebase) → #211/#217 (rebase) → #213 → #208/#209 → #155 (after owner env). Runtime/auth PRs need owner review; agents merge only docs/test/CI PRs.
