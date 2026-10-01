# Portfolio 10-phase roadmap — 2026-10-01 06:00 EDT

1. Freeze the production truth. Conduit `/ready` 200 on postgres. Resonance `/api/ready` 503 until SERVICE_ROLE. Do not invent secrets.
2. Owner sets `SUPABASE_SERVICE_ROLE_KEY` on resonancenexus only. Exit: `/api/ready` 200 without echoing the key. CHR-54.
3. Turn on Conduit TLS verify. Set `DATABASE_SSL_REJECT_UNAUTHORIZED=true` on Render, prove `/ready` still 200, then merge the verify-default follow-up. #155 stays closed until that probe.
4. Set `CONDUIT_CURSOR_SECRET` (>=16) and reject unsigned cursors in production. Code is in; secret is owner-side.
5. Quicksilver device HG. Archive an IPA from current main on iPhone 16e. CHR-55. Simulator CI is not HG.
6. Land on-device conversation retrieval. MemoryQuery text overlap is the first slice; next is wiring it into the ask path, not another docs hour.
7. Repair or close red Conduit drafts #119 and #120 off current main. Do not merge red.
8. Resonance iOS cockpit: merge the buildable XcodeGen target only after phase 2, then wire intent approval. CHR-39.
9. Chamber lifecycle with lease and evidence. Blocked by phase 2. No Quicksilver types in Resonance core.
10. Prune leftover branches and archive `cknowlesbadluck/Quicksilver` plus archived `mcp`. One source of truth per product.
