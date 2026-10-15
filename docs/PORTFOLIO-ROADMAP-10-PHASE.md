# Portfolio — 10-Phase Production-Readiness Roadmap (refined 2026-10-14 22:05 EDT)

Scope: three independent projects, kept separate. No shared runtime code and no cross-repo merges; the planes talk only through documented HTTP contracts. Each section below is owned by its own repo.
Principles: provider-neutral, free-tier only, no secrets in code or docs, every phase reversible, fail-closed, nothing merged by agents.

## Live evidence (2026-10-14 ~18:00Z / 14:20 EDT, `scripts/portfolio-probe.mjs`, #218)

| Target | Outcome | Detail |
|---|---|---|
| conduit-feco.onrender.com/ready | ready | 200, 0.8.0, contractRevision 2026-10-03-ready-surface, postgres |
| resonancenexus.netlify.app/api/ready | not_ready | 503, missingRequired = [SUPABASE_SERVICE_ROLE_KEY] (owner gate) |
| resonance.vercel.app | stranger_occupant | 200, not our deployment |
| quicksilver.vercel.app | stranger_occupant | 200, not our deployment |
| resonancenexus.vercel.app | alias_absent | 404 DEPLOYMENT_NOT_FOUND |
| quicksilverv1.vercel.app | alias_absent | 404 DEPLOYMENT_NOT_FOUND |

Device: CHR-55 is the only device gate. deviceAcceptance = not_recorded. No device evidence is claimed anywhere.

## Phases (shared shape, per-project work)

| # | Phase | Exit criteria |
|---|---|---|
| 1 | Green, pinned CI | main green; actions SHA-pinned; only real checks required |
| 2 | One wiring / one envelope | Tests exercise production wiring; uniform sanitized error envelope |
| 3 | Fail-closed auth & lockdown | Prod refuses dev/anonymous modes at startup |
| 4 | Minimal public surface + limits | Unauthenticated routes bounded and rate-limited |
| 5 | Transport & data security | Verified DB TLS; DB enforces tenancy |
| 6 | Honest posture | `/ready` never green on cold start or missing config; probe classifies fail-closed |
| 7 | Capability gates | Undeclared capability ⇒ refuse + audit |
| 8 | Safe schema evolution | Forward-only migrations tested on CI Postgres; never applied by agents |
| 9 | Contract tests + coverage gate | Protocol/adapter contracts pinned; drift fails CI |
| 10 | Operable release | Tagged release, runbook, rollback rehearsed, live probe green |

## Conduit (MCP coordination bridge, Render + Postgres)

Status: live ready. Workers Builds check red on every PR (not a deploy target).
1. #197 CI pins, #198 deps; owner: disconnect Workers Builds. 2. #211 app-factory wiring → #217 SSE admission 503 at cap. 3. #206 lockdown, #212 grants required in prod, #209 trust proxy. 4. #208 diagnostics cache, #207 typed tool inputs, #213 honest Workers handler; per-tool + external rate limits already on main. 5. DB TLS: #155 canonical (verify-on; Render env first); split HMAC cursors out of #162. 6. #203 cold_start posture; #218 portfolio probe + #219 scheduled report-only run (owner: keep here or move out; #210 removes legacy portfolio-posture.mjs). 7. Per-tool capability map, deny-by-default for integration_call/mcp_bridge_call. 8. #120 ordered migrations (draft). 9. #214 coverage gate, #204 pagination perf. 10. #216 timeouts; SSE drain (rest of #119); tag 0.9.0.
Merge order: #197 → #198 → #206 → #211 → #217, #212 → #209 → #207, #208, #213 → #204 → #216 → #214 → #210 or #203 → #218 → #219 → TLS (#155) after Render env → #205.

## Resonance (provider-neutral Nexus, Next.js 15 + Supabase, Netlify)

Status: prod 503, owner gate SUPABASE_SERVICE_ROLE_KEY; main CI red since e8df8f6.
1. #161 lockfile (unblocker; also clears Dependabot #1–#4 postcss), #162 workflows, #164 Dependabot; owner: branch protection (#165). 2. #172, #177, #181 error envelope + requestId. 3. #174 auth fail-closed. 4. #176, #180 route tests. 5. #175 rate limit; cursor pagination next. 6. #169 cold_start, #170 contract self-check. 7. #182 adapter contract tests; capability manifest + executor refusal (CHR-33). 8. #173 search_path (authored, NOT applied). 9. #178 commitSha → #179 parity check. 10. Owner sets key → `/api/ready` 200 (CHR-54); runbook.
Merge order: #161 → #162, #164 → #172 → #176 → #177 → #181 / #178 → #179 / #180 → #174, #175, #169, #170, #182 → #173 → #171.

## QuicksilverV1 (iOS; owned by Quicksilver Dev; read-only here)

Status: no live web alias of ours (quicksilver.vercel.app is a stranger, quicksilverv1.vercel.app absent). Device gate CHR-55 not_recorded.
Open drafts #280–#291: no file overlap or duplicates. #283–#287 are one-file slices of issue #252 (@unchecked Sendable) and could be consolidated. Hygiene decisions belong to Quicksilver Dev.

## Latest live probe (2026-10-14 22:05 EDT, #218 probe, 1 run + 1 /health call)

| Target | Outcome |
|---|---|
| conduit-feco.onrender.com /health, /ready | **ready** 200, 0.8.0, contractRevision 2026-10-03-ready-surface (recovered; was edge-503 down 18:02–18:13 EDT, then a Cloudflare challenge) |
| resonancenexus.netlify.app/api/ready | not_ready 503, missing [SUPABASE_SERVICE_ROLE_KEY] |
| Supabase Resonance / Quicksilver / WhereamI? | INACTIVE (paused), read-only API |
| resonance.vercel.app, quicksilver.vercel.app | stranger_occupant (no service stamp) |
| resonancenexus.vercel.app, quicksilverv1.vercel.app | alias_absent 404 |
| Device CHR-55 | not_recorded |

Roadmap summary: phases 1–2 are blocked on merges (Resonance #161; Conduit #197 → #211). Phases 3–6 and 9 are authored and green, waiting on review. Phase 5 TLS and phase 10 are owner-gated (Render DB TLS env; restoring the Supabase DB + setting the service-role key). Innovate: I1 scheduled report-only probe = Conduit #219 (on #218); I2–I4 not started.
