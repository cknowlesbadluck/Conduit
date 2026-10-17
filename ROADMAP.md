# Portfolio Roadmap — 10 phases

Canonical, unified roadmap for **Conduit** (MCP bridge), **Resonance** (integration plane) and **QuicksilverV1** (iOS product, owned by Quicksilver Dev). The repos stay separate and talk only through documented HTTP/MCP contracts. Live status and PR merge order: `docs/PORTFOLIO-ROADMAP-10-PHASE.md`. Current audit: `docs/AUDIT-2026-10-15.md`. Update these in place; do not add dated audit files.

Ground rules: agents never apply migrations, change production config, or spend money. Each phase is done only when **every** exit check below is true for each project. Status tags: **[passed]** · **[in progress]** · **[blocked]** (needs owner action). Last observed 2026-10-16 10:05 EDT: Conduit main CI + Live Smoke green, `/ready` 200; Resonance main CI green, `/api/ready` 503 (missing `SUPABASE_SERVICE_ROLE_KEY`); QuicksilverV1 main CI green.

## Stabilization

| # | Phase | Conduit exit check | Resonance exit check | Quicksilver exit check |
|---|---|---|---|---|
| 1 | Green, pinned CI | **[blocked]** main CI + Live Smoke green ✓; every action SHA-pinned ✓; Cloudflare Workers Builds still fails on PRs (owner: disconnect) | **[blocked]** main CI green ✓; actions SHA-pinned ✓; branch protection decision #165 (owner) | **[passed]** main CI green; actions SHA-pinned |
| 2 | Lean code | **[passed]** no unreferenced modules/scripts (#210, #232, #233 merged); no TODO/FIXME/XXX in src | **[in progress]** `identity.ts` removed (#192) ✓; `lib/ai` (#183) and chambers/policy (#193) open | **[in progress]** dead UI pruned (#308); LoggerService Sendable (#284) |
| 3 | Fail-closed auth | **[in progress]** every tool scope-gated (#222) ✓; grant-tool authz matrix tested (#235); lockdown independent of `NODE_ENV` (#206/#212) open; grant expiry fails closed (#234) open | **[in progress]** `RESONANCE_AUTH_MODE` fails closed (#174) open (live reports `authMode: required`); host-signal prod detection (#185) open | n/a (client) |
| 4 | Bounded surface | **[in progress]** retention (#223), redaction (#228), timeouts (#216) ✓; SSE cap → 503 (#217) open; pageLimit clamp (#231) open | **[in progress]** rate limit (#175), idempotency cap (#186), evidence redaction (#191) open | **[in progress]** bounded memory; budget awareness (#311) |

## Production readiness

| # | Phase | Conduit exit check | Resonance exit check | Quicksilver exit check |
|---|---|---|---|---|
| 5 | Transport + data security | **[blocked]** Postgres TLS verified (#155, after Render env, owner) | **[blocked]** `search_path` fix (#173) applied by owner; RLS lint (#195) + read-only verify (#196) open, need review and an owner run | **[blocked]** own Supabase restored (owner) |
| 6 | Honest posture | **[in progress]** `/ready` 200 with contractRevision ✓; scheduled probe: #219 merged but `.github/workflows/portfolio-probe.yml` is absent from main, so no schedule runs | **[blocked]** `/api/ready` 200 with commitSha (#178); live 503 with missing service-role key; Netlify prod deploying current main (owner) | — |
| 7 | Contracts + coverage | **[in progress]** tool-surface snapshot (#225) ✓; coverage gate enforced (lines 64 / branches 70 / functions 66), target ≥70% lines (main 69.7%, 72.0% with #235) | **[in progress]** cross-plane contract (#184); route tests (#176/#180) open | **[in progress]** TSan job (#309); contract client tests |
| 8 | Operable release | **[in progress]** runbook; tag 0.9.0; SSE drain (#119 draft) | **[blocked]** runbook (#197) open; CHR-54 closed only when `/api/ready` 200 (owner key) | **[blocked]** fresh Archive/IPA; CHR-55 device acceptance with real evidence (not recorded) |

## Innovation

| # | Phase | Conduit exit check | Resonance exit check | Quicksilver exit check |
|---|---|---|---|---|
| 9 | Adapters, chambers, on-device | **[in progress]** capability metadata in `tools/list`; streamable/resumable sessions | **[in progress]** provider-neutral adapter contract (#182) + failover (#188); chamber policy decided (#157) | **[in progress]** on-device intelligence path works offline; calls Resonance capabilities only via contract |
| 10 | Free tiers, SideStore, privacy | **[in progress]** zero paid add-ons ✓; diagnostics never echo credentials (#226) ✓; free-tier cold start documented | **[in progress]** free-tier budget documented; evidence privacy floor (#191) | **[in progress]** SideStore sideload build documented and reproducible; privacy manifest + no third-party telemetry |
