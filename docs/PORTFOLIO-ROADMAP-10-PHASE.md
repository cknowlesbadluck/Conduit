# Portfolio 10-phase roadmap — 2026-09-30 23:03 EDT

1. Ready-or-refuse on Resonance — DONE on main. Live 503. `missingRequired` is exactly `SUPABASE_SERVICE_ROLE_KEY`.
2. Owner SERVICE_ROLE on resonancenexus plus GitHub-backed redeploy. Exit `/api/ready` 200. CHR-54.
3. Durable GitHub adapter evidence. Bounded reads shipped on Resonance #131; live tokens still missing.
4. Quicksilver device HG from a green main. CHR-55. Simulator CI is not acceptance.
5. QS #198 `955585a` hardens the UI smoke terminate race. Do not squash until the new checks are green. Then M2-T6.
6. Conduit freeze on #119/#120. Repair off current main (`b582429b`) only. #155 stays open until Render TLS env is set.
7. Keyset pagination DONE (#125). HTTP `/diagnostics` DONE live 200. #152 path guard and #156 eviction are on main. `activity_prune` removed 0 rows this pass.
8. Resonance iOS I1 blocked by phase 2.
9. Chamber lifecycle blocked by phase 2.
10. Release surface + owner prune of leftover Conduit branches (`docs/hygiene-*`, `codex/*`, `bolt/*`, `counsel/*`, `release/0.8.0`). No delete-ref tool on this connector.

## Innovative implementations

A. QS smoke harness fix on #198. Not merged this pass.
B. Resonance #139 locks the live 503 shape in CI. Not a production claim.
C. TLS verify stays on #155. Do not merge until Render `CONDUIT_DB_SSL_MODE` / cert env is set.
