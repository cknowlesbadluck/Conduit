# Conduit — 10-Phase Roadmap to a hardened 0.8+ (updated in place 2026-10-16 18:10 EDT)

Target: hardened Conduit 0.8+ → 0.9.0 with reliable grants and low PR entropy. Cross-repo view: `ROADMAP.md`. Current audit: `docs/AUDIT-2026-10-15.md`. Repos stay separate; Conduit talks to Resonance only through HTTP/MCP contracts.
These are **Conduit workstreams C1–C10**, numbered separately from the canonical portfolio phases 1–10 in `ROADMAP.md`. "C10" means the Conduit release workstream, not portfolio phase 10.
Status: **[passed]** · **[in progress]** · **[blocked]** (owner action).

| # | Workstream | Exit criteria | Status |
|---|---|---|---|
| C1 | Green, pinned CI | main CI + Live Smoke green; actions SHA-pinned; no owner-side red check on PRs | **[blocked]**: green ✓, pinned ✓; Cloudflare Workers Builds still red on every PR (owner: disconnect) |
| C2 | Lean code | no unreferenced modules; no TODO/FIXME in src | **[passed]** (#210, #232, #233) |
| C3 | Reliable grants | admin actions subject-matched; admins can revoke any grant (#238); expiry fails closed + refuse expired (#234); authz matrix tested (#235 ✓) | **[in progress]**: #238 and #234 open, need owner review |
| C4 | Fail-closed production | lockdown + capabilities-required independent of `NODE_ENV` (#206 → #212) | **[in progress]**: #206 changes requested; #212 conflicting |
| C5 | Bounded surface | retention/redaction/timeouts ✓; SSE cap → 503 (#217); pageLimit clamp (#231); diagnostics cache (#208) | **[in progress]** |
| C6 | Transport + data security | Postgres TLS verified by default (#155), after the owner sets the Render env | **[blocked]** (owner env) |
| C7 | Honest posture + drift | `/ready` 200 + contractRevision ✓; scheduled probe on main (#239 ✓); drift detection (#241 ✓); Workers handler honest (#213) | **[in progress]** |
| C8 | Contracts + coverage | tool-surface snapshot ✓; coverage ≥70% lines; JSON-typed schemas (#207) | **[in progress]** |
| C9 | Low entropy | ≤8 open non-draft PRs; nothing conflicting for more than 3 days; stacks rebased onto main; red drafts (#119/#120) decided | **[in progress]**: 23 open PRs on 2026-10-16 18:10 EDT (#244 closed as duplicate of #242; #204/#231 pagination are complementary, not duplicates) |
| C10 | Operable release 0.9.0 | runbook; SSE drain; tag 0.9.0; contractRevision change policy in SPEC.md; 7 days of probe drift=false | **[in progress]** |

## Merge order (grants train first)

Done: #241 (merged 2026-10-16 14:08 EDT). Pending: #238 → #234 → #206 → #212 (rebase) → #211/#217 (rebase) → #213 → #208/#209 → #231 → #243 (URL redaction) → #245/#246 (probe shape + parity, one-line rebase between them) → #155 (after owner env). **Merge authorization (single policy):** agents may merge only Conduit docs/test/CI-only PRs that are green (ignoring the owner-side Workers Builds check) with no outstanding changes-requested or unaddressed bot findings, then verify `/ready` returns 200. Runtime/auth PRs and every Resonance/QuicksilverV1 PR need the owner. This supersedes any older "agents never merge" wording preserved below.

## Portfolio status and cross-repo merge order (preserved from the 2026-10-15 22:30 EDT refinement)

> Canonical phase definitions and exit checks now live in `/ROADMAP.md`. This file tracks live evidence and merge order. 2026-10-16: Conduit #228, #216, #210, #223, #205 merged (/ready 200 after each); Resonance #192 merged (/api/ready still honest 503).

Products: **QuicksilverV1** (primary product, iOS, owned by Quicksilver Dev), **Resonance** (provider-neutral integration plane), **Conduit** (MCP coordination bridge). These are separate repos with no shared runtime; they talk only through documented HTTP/MCP contracts. Agents never apply migrations or change prod config, and merge only under the single policy above. Current audit: `docs/AUDIT-2026-10-15.md`.

### Live evidence (22:05 EDT)

Conduit `conduit-feco.onrender.com/ready` 200 (0.8.0, contractRevision 2026-10-03-ready-surface, postgres) after #222/#225/#227 merges · Resonance Netlify `/api/ready` 503, missing [SUPABASE_SERVICE_ROLE_KEY]; prod still deploy 6ab8ea11 (main 5aeffb4, 09-27): the 15:15 merges of #161/#162/#164 (main 7b662a0) produced **no** new Netlify production deploy (no Netlify commit status on 7b662a0; PR previews still run): either production builds fail (stale lockfile) or the production Git link is inactive. Still deploy 6ab8ea11 at 22:05 (Netlify API currentDeploy). Owner to check the Netlify deploy log · Supabase Resonance/Quicksilver/WhereamI? INACTIVE · resonance/quicksilver.vercel.app stranger_occupant · resonancenexus/quicksilverv1.vercel.app alias_absent · CHR-55 not_recorded.

### Phases

| # | Phase | Quicksilver (read-only here) | Resonance | Conduit |
|---|---|---|---|---|
| 1 | Green, pinned CI | main green; 8 PRs merged 10-15 | **#161, #162, #164 merged 15:15**; owner: branch protection #165 | **#197, #214 merged**; **#227 merged** (branch-coverage gate rebaselined 74→70 after #222/#225); #198; owner: disconnect Workers Builds |
| 2 | Lean code | #283–#287 (#252) consolidate | #183 lib/ai prune; #192 identity.ts prune; chambers + policy/gate decision | **#220 merged**; #210 legacy posture script |
| 3 | Fail-closed auth/lockdown | (n/a) | #174 auth, #185 prod detection | #206 → #211, #212; **#222 merged** (every tool scope-gated) |
| 4 | Bounded surface | bounded memory (#296) | #175 rate limit, #186 idempotency bound; #191 evidence redaction | #217 SSE cap (on #211), #208, #207, #213, #223 activity retention; **#228 activity/log redaction** |
| 5 | Transport/data security | restore its Supabase | #173 search_path (NOT applied); RLS tests next | #155 TLS (after Render env); cursors split from #162 |
| 6 | Honest posture | (n/a) | #169, #170; #178 → #179 deploy parity | #203 or #210; #218 probe → #219 schedule |
| 7 | Capability gates / composition | device plans call Resonance capabilities | #182 adapter contract; #188 provider failover; manifest + refusal (CHR-33) | capability metadata in tools/list |
| 8 | Cross-plane proof | contract client | #184 /api/ready + envelope contract; **#191 evidence privacy floor (credential redaction)** | **#225 merged** tool-surface snapshot; #226 diagnostics redaction invariant |
| 9 | Contract + coverage | tests merged 10-15 (#289–#291) | #176 → #177 → #181, #180 | #214 coverage gate, #204 perf, #216 timeouts |
| 10 | Operable release | CHR-55 device acceptance (real evidence only); fresh Archive IPA | owner: restore DB + key → `/api/ready` 200 (CHR-54); runbook | SSE drain (#119 rest), tag 0.9.0, runbook |

**Innovate:** I5 evidence privacy floor (Resonance #191) · I6 diagnostics never echo credentials (Conduit #226) · I1 scheduled probe (#219, done) · I2 cross-plane contract (#184, done) · I3 exempt /health,/ready from bot challenge (owner config) · I4 PR-stack report (pattern exists as Quicksilver #294; not ported) · Quicksilver on-device intelligence (#282, #295, #297) · Conduit MCP: streamable sessions, resumable SSE.

### Merge order (actual bases)

- **Resonance** (all on main unless noted; owner merges only — Netlify publishes prod once its build link is restored): #172 → #176 → #177 → {#181, #178 → {#179, #180}} (still stacked on audit/* branches) · independent: #169, #170, #173, #174, #175, #182–#188, #191 · then #171. Dependabot #189 (actions majors, CI green) / #190 (npm group, CI green, behind main; lucide-react 0.468→0.577 is a 0.x minor, so check icons render) are ready for owner review. #192 prune is independent.
- **Conduit:** #197 → #198 → #206 → {#211 → #217, #212} → #209 → #207, #208, #213 → #204 → #216 → #214 → #220, #222, #224, #225 (merged) → #227 (merged) → #226 (merged) → #223 (runtime) → #228 (runtime, redaction) → #210 or #203 → #218 → #219 → #155 (after Render TLS env) → #205.
- **Held:** Conduit #119/#120 (draft), #162 (split), #187/#190 (experiments). Resonance #154/#157 (experiments), #158 (rebase). Closed 10-15: Conduit #221 (superseded by #204).
