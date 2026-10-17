# Conduit — 10-Phase Roadmap to a hardened 0.8+ (updated in place 2026-10-17 03:30 EDT)

Target: hardened Conduit 0.8+ → 0.9.0 with reliable grants and low PR entropy. Cross-repo view: `ROADMAP.md`. Current audit: `docs/AUDIT-2026-10-15.md`. Repos stay separate; Conduit talks to Resonance only through HTTP/MCP contracts.
These are **Conduit workstreams C1–C10**, numbered separately from the canonical portfolio phases 1–10 in `ROADMAP.md`. "C10" means the Conduit release workstream, not portfolio phase 10.
Status: **[passed]** · **[in progress]** · **[blocked]** (owner action).

| # | Workstream | Exit criteria | Status |
|---|---|---|---|
| C1 | Green, pinned CI | main CI + Live Smoke green; actions SHA-pinned; no owner-side red check on PRs | **[blocked]**: green ✓, pinned ✓; Cloudflare Workers Builds still red on every PR (owner: disconnect) |
| C2 | Lean code | no unreferenced modules; no TODO/FIXME in src | **[passed]** (#210, #232, #233) |
| C3 | Reliable grants | admin actions subject-matched; admins can revoke any grant (#238); expiry fails closed + refuse expired (#234); authz matrix tested (#235 ✓); token verifier fail-closed paths tested (#250) | **[in progress]**: #238, #234, #250 open, need owner review |
| C4 | Fail-closed production | lockdown + capabilities-required independent of `NODE_ENV` (#206 → #212) | **[in progress]**: #206 changes requested; #212 conflicting |
| C5 | Bounded surface | retention/redaction/timeouts ✓; SSE cap → 503 (#217); pageLimit clamp (#231); diagnostics cache (#208); one shared pg pool, bounded listAgents, batched prune (#251); `conduit_context` rejects an ambiguous top-level `cursor` (#253) | **[in progress]** |
| C6 | Transport + data security | Postgres TLS verified by default (#155), after the owner sets the Render env | **[blocked]** (owner env) |
| C7 | Honest posture + drift | `/ready` 200 + contractRevision ✓; scheduled probe on main (#239 ✓); drift detection (#241 ✓); Workers handler honest (#213) | **[in progress]** |
| C8 | Contracts + coverage | tool-surface snapshot ✓; coverage ≥70% lines; JSON-typed schemas (#207); dual-mode store tests run in the Postgres CI job, which also fixes the Postgres Agent shape (#254); ESLint baseline (#252) | **[in progress]**: store.js 74.9→77.7% lines in Postgres mode with #254 |
| C9 | Low entropy | ≤8 open non-draft PRs; nothing conflicting for more than 3 days; stacks rebased onto main; red drafts (#119/#120) decided | **[in progress]**: 23 open PRs on 2026-10-16 18:10 EDT (#244 closed as duplicate of #242; #204/#231 pagination are complementary, not duplicates) |
| C10 | Operable release 0.9.0 | runbook; SSE drain; tag 0.9.0; contractRevision change policy in SPEC.md; 7 days of probe drift=false | **[in progress]** |

## Composition and coordination principles (no party dominates)

Conduit is the coordination bridge. It records who is doing what, and it must never become the party that decides for everyone.

1. **Claims, not commands.** Agents claim, block, release and hand off tasks. Conduit enforces transitions atomically (one winner per claim or handoff) but never assigns work on its own initiative.
2. **Bounded by construction.** Every list and context read is paged and capped (`pageLimit` 1..200, per-section `cursors` in `conduit_context`). Ambiguous input is rejected, not guessed (#253). One shared pool and bounded reads (#251) mean one caller can't exhaust the database for everyone.
3. **Fair admission.** Per-IP rate limits and the SSE subscriber cap (#217) return 429/503 with `Retry-After` instead of hanging, so a noisy client degrades alone.
4. **Identity is bound, scope is explicit.** A subject binds to one logical agent and every tool is scope-gated. Grants are subject-matched and expire fail-closed (#238, #234).
5. **Honest posture.** `/ready` and `/health` report what is true (`contractRevision`, persistence), never a fake ready.
6. **Separate planes.** Conduit talks to Resonance only over HTTP/MCP contracts. It shares no runtime, database or secrets with Resonance or QuicksilverV1.

## Integration hygiene rules

- **Off by default.** An integration or MCP bridge target is inert until it's explicitly configured *and* granted. Missing configuration means absent, not present-and-broken.
- **Destination from config only (target; partly met).** `integration_call` resolves providers server-side. **Gap:** `mcp_bridge_call` still takes `endpoint` from tool input. It's guarded (HTTPS only, no credentials in the URL, SSRF block on private, loopback and link-local addresses with a pinned DNS answer, and a capability grant on origin+path when grants are required), but the rule is not met until the endpoint must match a registered `tool`/`resource` or a configured allowlist. Tracked as roadmap C5. Echoed URLs are redacted (#243).
- **Approval-gated outbound.** In production (grants required), outbound calls need a grant for that capability and subject, and are rate limited per agent and provider. Admin grants are subject-matched, and expired or unparseable grants fail closed.
- **Idempotent delivery.** Writes are claim-checked and transition-guarded, so a retried claim, complete or handoff is a no-op or a refusal, never a double effect. Callers retry only on 429/503.
- **No secrets in flight records.** Activity, diagnostics and errors are redacted (#228, #226). Tokens never appear in logs or responses.

## Merge order (grants train first)

Done: #241 (merged 2026-10-16 14:08 EDT), #246 report-only deploy-parity annotation (merged 2026-10-16 18:45 EDT, d30e7dc). Pending: #250 (tests) → #253/#254 (tests + small fixes) → #252 (lint) → #251 (perf) → #238 → #234 → #206 → #212 (rebase) → #211/#217 (rebase) → #213 → #208/#209 → #231 → #243 (URL redaction) → #245 (probe shape; already on top of #246) → #155 (after owner env). **Merge authorization (single policy):** agents may merge only Conduit docs/test/CI-only PRs that are green (ignoring the owner-side Workers Builds check) with no outstanding changes-requested or unaddressed bot findings, then verify `/ready` returns 200. Runtime/auth PRs and every Resonance/QuicksilverV1 PR need the owner. This supersedes any older "agents never merge" wording preserved below.

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
