# Portfolio Roadmap — 10 phases

Canonical, unified roadmap for **Conduit** (MCP bridge), **Resonance** (integration plane) and **QuicksilverV1** (iOS product, owned by Quicksilver Dev). The repos stay separate and talk only through documented HTTP/MCP contracts. Live status and PR merge order: `docs/PORTFOLIO-ROADMAP-10-PHASE.md`. Current audit: `docs/AUDIT-2026-10-15.md`. Update these in place; do not add dated audit files.

Ground rules: agents never apply migrations, change production config, or spend money. Each phase is done only when **every** exit check below is true for each project.

## Stabilization

| # | Phase | Conduit exit check | Resonance exit check | Quicksilver exit check |
|---|---|---|---|---|
| 1 | Green, pinned CI | main CI + Live Smoke green; every action SHA-pinned; Cloudflare Workers Builds disconnected (owner) | main CI green; actions SHA-pinned; branch protection reviewed (owner) | main CI green; actions SHA-pinned |
| 2 | Lean code | no unreferenced modules/scripts (#210 done) | `lib/ai` (#183) and `identity.ts` (#192, done) removed | dead UI pruned (#308); LoggerService Sendable (#284) |
| 3 | Fail-closed auth | production lockdown independent of `NODE_ENV` (#206/#212); every tool scope-gated | `RESONANCE_AUTH_MODE` fails closed (#174); prod detection uses host signals (#185) | n/a (client) |
| 4 | Bounded surface | SSE cap → 503 (#217); activity retention (#223, done); redaction (#228, done); finite timeouts (#216, done) | rate limit (#175); idempotency cap (#186); evidence redaction (#191) | bounded memory; budget awareness (#311) |

## Production readiness

| # | Phase | Conduit exit check | Resonance exit check | Quicksilver exit check |
|---|---|---|---|---|
| 5 | Transport + data security | Postgres TLS verified (#155 after Render env, owner) | `search_path` fix (#173) applied by owner; RLS tests | own Supabase restored (owner) |
| 6 | Honest posture | `/ready` 200 with contractRevision; scheduled probe (#219) | `/api/ready` 200 with commitSha (#178); Netlify prod deploys current main (owner: service-role key + build link) | — |
| 7 | Contracts + coverage | tool-surface snapshot; coverage gate ≥70% | cross-plane contract (#184); route tests (#176/#180) | TSan job (#309); contract client tests |
| 8 | Operable release | runbook; tag 0.9.0; SSE drain | runbook; CHR-54 closed (`/api/ready` 200) | fresh Archive/IPA; CHR-55 device acceptance with real evidence |

## Innovation

| # | Phase | Conduit exit check | Resonance exit check | Quicksilver exit check |
|---|---|---|---|---|
| 9 | Adapters, chambers, on-device | capability metadata in `tools/list`; streamable/resumable sessions | provider-neutral adapter contract (#182) + failover (#188); chamber policy decided (#157) | on-device intelligence path works offline; calls Resonance capabilities only via contract |
| 10 | Free tiers, SideStore, privacy | runs on free tiers with zero paid add-ons; diagnostics never echo credentials | free-tier budget documented; evidence privacy floor enforced | SideStore sideload build documented and reproducible; privacy manifest + no third-party telemetry |
