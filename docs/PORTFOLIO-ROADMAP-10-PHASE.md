# Portfolio 10-phase roadmap — 2026-10-02 17:00 EDT

Evidence from live probes this session. Conduit coordinates. It does not own Resonance or Quicksilver runtime.

Probes: Conduit `/health` 200, `/ready` 200 postgres 0.8.0. Resonance `https://resonancenexus.netlify.app/api/ready` 503, missing exactly `SUPABASE_SERVICE_ROLE_KEY`, authMode required, persistence and GitHub adapter not configured. `cknowlesbadluck/mcp` is archived. `cknowlesbadluck/Quicksilver` is not archived.

1. Entropy collapse. Close superseded docs-only hygiene PRs. Do not open another hourly audit file. `classifyEntropy` is the gate.
2. Owner sets `SUPABASE_SERVICE_ROLE_KEY` on Netlify site `resonancenexus` only. Exit: `/api/ready` 200. Do not invent the secret. Do not switch hosts.
3. Resonance code queue, one merge at a time: #145 deploy-lag classifier, then #133 audit fixes, then #132 catalog. Kill on red CI. Do not stack.
4. Conduit freeze holds for #119 #120 #155 #162. Merge #164 only if required checks are green. Bolt PRs #161 and #165 are review-or-drop, not a stack.
5. QuicksilverV1 is the only intelligence repo. Decide #207 gateway scaffold on CI. Device HG remains CHR-55 on a physical iPhone 16e. Simulator CI is not acceptance.
6. Owner archives `cknowlesbadluck/Quicksilver`. PRs #1 and #2 are abandoned. This connector cannot archive the repo.
7. Durable Resonance GitHub adapter evidence after phase 2, with deny proofs. Needs `GITHUB_TOKEN` and `GITHUB_WEBHOOK_SECRET`.
8. Resonance iOS I1 (compose, plan, execute, approve) against a ready host. #134 stays blocked until phase 2 and a green app-target CI job.
9. Chamber form, work, dissolve, with audit intact. Blocked by phase 2.
10. Release surface: SideStore/IPA evidence, production smoke unskipped, owner deletes leftover `docs/hygiene-*`, `codex/*`, and `bolt/*` branches. Keep `release/0.8.0` until tagged.

Binding constraints: owner Netlify secret, physical device, Render TLS env, branch-delete permission.
