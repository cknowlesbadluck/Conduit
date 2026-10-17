# Conduit — 10-Phase Roadmap to a hardened 0.8+ (updated in place 2026-10-17 13:35 EDT)

Target: hardened Conduit 0.8+ → 0.9.0 with reliable grants and low PR entropy. Cross-repo view: `ROADMAP.md`. Current audit: `docs/AUDIT-2026-10-15.md`. Repos stay separate; Conduit talks to Resonance only through HTTP/MCP contracts.
These are **Conduit workstreams C1–C10**, numbered separately from the canonical portfolio phases 1–10 in `ROADMAP.md`. "C10" means the Conduit release workstream, not portfolio phase 10.
Status vocabulary: **done** · **in review** (PRs open, CI green) · **blocked on owner** (owner action or env) · **not started**.

| # | Workstream | Exit criteria | Status (2026-10-17 07:20 EDT) |
|---|---|---|---|
| C1 | Green, pinned CI | main CI + Live Smoke green; actions SHA-pinned; no owner-side red check on PRs | **blocked on owner**: main CI, Live Smoke and portfolio-probe green on d30e7dc; actions pinned. Cloudflare "Workers Builds: conduit" still fails on every PR (#250–#256); owner must disconnect it |
| C2 | Lean code | no unreferenced modules; no TODO/FIXME in src | **done** (#210, #232, #233); #248 knip type un-exports in review |
| C3 | Reliable grants | admin actions subject-matched (#238); expiry fails closed (#234); authz matrix (#235 ✓); token verifier fail-closed paths (#250) | **in review**: #238, #234, #250 green (#250 CodeRabbit finding fixed in 546c86d; its stale CHANGES_REQUESTED clears on re-review) |
| C4 | Fail-closed production | lockdown + capabilities-required independent of `NODE_ENV` (#206 → #212) | **in review**: #206 (CodeRabbit changes requested), #212 now mergeable; both conflict on `src/index.ts` with #209/#211/#213/#217/#243, so rebase in merge order |
| C5 | Bounded surface | retention/redaction/timeouts ✓; SSE cap 503 (#217); pageLimit clamp (#231); diagnostics cache (#208); shared pool + bounded reads (#251); `conduit_context` rejects top-level `cursor` (#253); **bridge destination rule (#256)** | **in review**: #253 CodeRabbit finding fixed (9083fd7); #256 `report` by default (lint fix pushed 07:00 EDT); #257 opt-in signed bridge receipts |
| C6 | Transport + data security | Postgres TLS verified by default (#155) after the owner sets the Render env | **blocked on owner** (Render env); #155 conflicts with #251 (db-pool/store) |
| C7 | Honest posture + drift | `/ready` 200 + contractRevision ✓; scheduled probe (#239 ✓); drift detection (#241 ✓); commitSha on `/ready` (#247); Workers handler honest (#213) | **in review** (#247, #213, #245) |
| C8 | Contracts + coverage | tool-surface snapshot ✓; coverage ≥70% lines (main memory mode 74.6%); JSON-typed schemas (#207); dual-mode store tests + Postgres Agent shape fix (#254); ESLint baseline (#252) | **in review**: #252 (now contains #253, see merge train), #254, #207 green |
| C9 | Low entropy | ≤8 open non-draft PRs; nothing conflicting for more than 3 days; red drafts (#119/#120) decided | **in review / off target**: 32 open at 07:20 EDT (31 after closing #230 as a duplicate of #255, plus #257). Conflicting with main: #119, #120, #162 (owner decisions). 9 merged/closed-PR branches pruned 07:10 EDT |
| C10 | Operable release 0.9.0 | runbook; SSE drain; tag 0.9.0; contractRevision change policy; 7 days of probe drift=false | **not started** (blocked behind C3–C5 merges) |

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
- **Destination from config only (in review: #256).** `integration_call` resolves providers server-side. `mcp_bridge_call` still takes `endpoint` from tool input. It is guarded: HTTPS only, no credentials in the URL, an SSRF block on private, loopback and link-local addresses with a pinned DNS answer, and a capability grant on origin+path when grants are required. #256 adds the destination rule: the endpoint must match a registered tool or resource origin, or `CONDUIT_BRIDGE_ALLOWED_DESTINATIONS` (exact origin, exact host, or a leading `*.` only). The default mode is `report`, which logs and counts with a redacted host and blocks nothing. `enforce` is opt-in through `CONDUIT_BRIDGE_DESTINATION_MODE`. The mode and violation count show in `/diagnostics`. The rule is fully met once the owner flips to `enforce` after a clean report window. Echoed URLs are redacted (#243).
- **Approval-gated outbound.** In production (grants required), outbound calls need a grant for that capability and subject, and are rate limited per agent and provider. Admin grants are subject-matched, and expired or unparseable grants fail closed.
- **Idempotent delivery.** Writes are claim-checked and transition-guarded, so a retried claim, complete or handoff is a no-op or a refusal, never a double effect. Callers retry only on 429/503.
- **No secrets in flight records.** Activity, diagnostics and errors are redacted (#228, #226). Tokens never appear in logs or responses.

## Status board (2026-10-17 13:35 EDT; main 2a6745b, nothing merged since 12:15)

Tags: **[passed]** = exit check met on main · **[in progress]** = PRs open, CI green · **[blocked]** = needs owner action.

| Workstream | Tag | Exit check (how it's verified) |
|---|---|---|
| C1 Green CI | [blocked] | main CI + Live Smoke green on 2a6745b; owner disconnects Cloudflare "Workers Builds: conduit" (fails on main and every PR) |
| C2 Lean code | [passed] | #248 (un-export 12 knip-flagged types) and #252 (6 dead symbols) merged; no TODO/FIXME/XXX in `src/` |
| C3 Reliable grants | [in progress] | #250 verifier tests merged (auth.js 66% → 99%); **#238, #234 open (owner review)** |
| C4 Fail-closed production | [in progress] | **#206 → #212 open (owner review)**; lockdown independent of `NODE_ENV` |
| C5 Bounded surface | [in progress] | #253 merged; **#251, #256, #258, #231, #208 open**. MCP transport is stateless per request, so no session cap is needed |
| C6 Transport/data security | [blocked] | #155 is the single DB TLS owner and builds on #251 (one `src/db-pool.ts`); owner sets Render `DATABASE_SSL_CA` (or explicit opt-out), then #251 → #155, and `/ready` still 200. **#162 split done (9ddfa39):** its duplicate `postgres-ssl.ts` was dropped; #162 is now only opt-in HMAC cursors (3 files, green) |
| C7 Honest posture | [in progress] | `/ready` 200 ✓; #247 commitSha and #245 shape contract open |
| C8 Contracts + coverage | [in progress] | #252 lint gate (`eslint . --max-warnings=0` in CI) and #254 dual-mode store tests merged |
| C9 Low entropy | [in progress] | ≤8 open non-draft PRs. 29 open at 13:00 and 13:35 EDT (no merges, no closures: nothing clearly superseded). At 13:20 EDT all 24 main-based PRs passed `tsc` + `eslint . --max-warnings=0` when merged locally onto main. Conflicting with main: only the red drafts #119/#120. Stacked #211/#212/#217 showed CONFLICTING on GitHub (criss-cross merge bases) although `git merge-tree` was clean; merging the base into each head fixed it, and all three are MERGEABLE. Stacked PRs get no CI (CI runs only on PRs into `main`) |
| C10 Operable release 0.9.0 | not started | tag 0.9.0 after C3–C5; 7 days of probe drift=false |
| Innovation: merge-train health | [in progress] | **#260** `npm run merge-train [owner/repo]`: green/mergeable/not-owner-gated order, duplicate-new-file and overlap detection, conflict hotspots (report-only). 914fe52 adds stacked-PR awareness (never a candidate; no stack-pair noise) and latest-run-per-check semantics (a cancelled run is `rerun`, not red) |
| Innovation: stale-claim recovery | [in progress] | **#259** `task_reclaim` (opt-in) + `task_health` idle-age counts (owner review) |
| Innovation: signed bridge receipts | [in progress] | **#257** (opt-in, offline verifier; owner review, after #256) |

Merged 2026-10-17 (agent, CI green, `/ready` 200 after each): #250 → 4ca764f, #253 → ff5f7e4, #254 → af315da, #252 → a1c84b3, #248 → 2a6745b.

Overlap check (13:30 EDT, `npm run merge-train` from #260 @ 914fe52): the only duplicate new files are **#155 × #251** (`src/db-pool.ts` and the bounds tests). That is intended: #155 merges #251 and adds only the TLS policy, so merge #251 first. No heavy overlaps remain once stacked pairs are excluded. Conflict hotspots: `.env.example` (8 PRs), `src/store.ts` (7), `src/capability-store.ts`, `src/index.ts` and `README.md` (6 each). Candidates (green, mergeable, not owner-gated): #190, #208, #255, #242, #245, #207, #231, #247, #162, #260, #259.

## Merge train (2026-10-17 07:20 EDT, replaces the earlier "grants train first" order)

Nothing here is merged by agents. Every step was simulated locally on main d30e7dc: main + #250 → #253 → #254 → #252 → #251 → #256 → #238 → #234 → #206 → #212 with the resolutions below passes `tsc`, `eslint . --max-warnings=0` and `npm test` (223 pass, 0 fail).

| Step | PR | Depends on | Expected conflict and exact resolution |
|---|---|---|---|
| 1–3 | ~~#250, #253, #254~~ | | **merged 2026-10-17** |
| 4 | ~~#252 ESLint baseline~~ (**merged**; #248 also merged) | #253 (contained) | **#252 contains #253** (merge commit 45e0b0c + fd48a06). Without it, the pair merged silently into code that fails `tsc` (`_cursor` rename vs #253's use of `cursor`). If #253 lands first, #252's diff shrinks to the lint baseline |
| 5 | #251 shared pool + bounded reads | #254, #252 | `src/store.ts` `listAgents`: take #251's block (`AGENT_LIST_MAX`, `agentListLimit`, bounded `listAgents`, `existingAgentIds`) **and keep #254's `.rows.map(normalizeAgent)`** on the Postgres path. `ci.yml` Postgres job: union `dist/coordination.test.js dist/store.lifecycle.test.js dist/store.coverage.test.js dist/store.bounds.postgres.test.js` |
| 6 | #256 bridge destination rule (report-only) | #251 | `ci.yml` union: `… dist/store.coverage.test.js dist/store.bounds.postgres.test.js dist/bridge-destinations.test.js`; `src/store.ts` auto-merges |
| 7 | #238 grant admin subject match | main | none |
| 8 | #234 grant expiry fails closed | main | none |
| 9 | #206 production lockdown | main | none against steps 1–8; `src/index.ts` conflicts with #209/#211/#243/#217 later |
| 10 | #212 capabilities on any prod runtime | #206 (based on `audit/prod-lockdown`) | none after #206 |
| next | #257 signed bridge receipts (opt-in), then #258 bridge total deadline, then #259 stale-claim recovery (appends to `store.ts`; rebase after #251/#254) | #256 | both edit the `mcp_bridge_call` handler in `src/mcp.ts`: keep #256's destination check and #257's `recordBridgeReceipt` calls |
| later | #255 (Bolt redaction), #243 (redactUrl), #231, #208/#209, #213, #211→#217, #245, #247, #248, #249 | rebase in this order | `src/index.ts` pairs listed under Live evidence; #155 only after the owner sets the Render TLS env |

Held (owner decisions, not closed): #119, #120 (red drafts), #155 (Render env), #187/#190 (experiments). #162 split done 2026-10-17 (HMAC cursors only). Closed as duplicate: #230 → #255.

**Merge authorization (single policy):** agents may merge only Conduit docs/test/CI-only PRs that are green (ignoring the owner-side Workers Builds check) with no outstanding changes-requested or unaddressed bot findings, then verify `/ready` returns 200. Runtime/auth PRs and every Resonance/QuicksilverV1 PR need the owner. This supersedes any older "agents never merge" wording preserved below. **Override from 2026-10-17 13:00 EDT: the owner said "never merge to main without explicit need". Agents merge nothing in either repo until the owner says otherwise.**

## Portfolio status and cross-repo merge order (preserved from the 2026-10-15 22:30 EDT refinement)

> Canonical phase definitions and exit checks now live in `/ROADMAP.md`. This file tracks live evidence and merge order. 2026-10-16: Conduit #228, #216, #210, #223, #205 merged (/ready 200 after each); Resonance #192 merged (/api/ready still honest 503).

Products: **QuicksilverV1** (primary product, iOS, owned by Quicksilver Dev), **Resonance** (provider-neutral integration plane), **Conduit** (MCP coordination bridge). These are separate repos with no shared runtime; they talk only through documented HTTP/MCP contracts. Agents never apply migrations or change prod config, and merge only under the single policy above. Current audit: `docs/AUDIT-2026-10-15.md`.

### Live evidence (2026-10-17 04:02 EDT)

- **Conduit:** `conduit-feco.onrender.com/ready` returns **200** in 0.35 s with `{status: ready, version 0.8.0, contractRevision 2026-10-03-ready-surface, persistence: postgres}`; `/health` returns 200. main d30e7dc: CI, Live Smoke and portfolio-probe all green.
- **Resonance:** `resonancenexus.netlify.app/api/ready` returns **503** with `missingRequired: [SUPABASE_SERVICE_ROLE_KEY]`, `production: true`, `authMode: required`. The edge `age` header is about 19.9 days, which is still the 2026-09-27 deploy (owner: restore Netlify publishing and set the key). `resonanceplane.netlify.app` is behind Netlify edge access (401), and `resonanceplane.vercel.app` returns DEPLOYMENT_NOT_FOUND.
- **QuicksilverV1 (read-only):** main "Quicksilver CI" green (90a9bc6, 2026-10-16 19:52 EDT); 21 open PRs.
- **Conduit PR conflicts:** these are pairwise and exclude #119/#120/#162, which already conflict with main.
  - `src/index.ts`: #206×#209, #206×#243, #209×#211, #209×#212, #209×#217, #211×#213, #211×#243, #212×#243, #213×#217, #217×#243.
  - `src/app-factory.ts`: #211×#252, #217×#252.
  - `src/store.ts`: #204×#251, #204×#254, #251×#254 (also `ci.yml`).
  - #155×#251 (db pool).
  - #230×#255 (duplicate Bolt redaction).
  - #256×#251 and #256×#254 (`ci.yml` one-liner).

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
