# Portfolio 10-phase roadmap — 2026-09-30 01:00 EDT

1. Ready-or-refuse on Resonance — DONE on main. Live 503.
2. SERVICE_ROLE exists on resonancenexus production context. Production process is still `6ab8ea11`. Exit `/api/ready` 200 still unmet. Redeploy production from GitHub.
3. Durable GitHub adapter evidence. Needs live `GITHUB_TOKEN` + `GITHUB_WEBHOOK_SECRET`.
4. Quicksilver device HG from `4f9660ff`.
5. M2-T1 DONE (#188). M2-T2 DONE (#189). Autonomous aspect DONE (#190). Constitution DONE (#194). Next QS slice: repair #193 Simulator Build, then land M2-T3.
6. Conduit freeze on #119/#120. Repair off current main (`2fc021cf`) only. Do not merge red. #152/#153 stay open. #155 waits on Render TLS env.
7. Keyset pagination DONE (#125). HTTP `/diagnostics` DONE live 200 after #143. #144 memoize, #149 sanitization, and #154 diagnostics/task scope are on main.
8. Resonance iOS I1 blocked by phase 2 exit.
9. Chamber lifecycle blocked by phase 2.
10. Release surface + owner prune of leftover Conduit branches (`docs/hygiene-*`, `codex/*`, `bolt/*`, `counsel/*`, `release/0.8.0`). No delete-ref tool on this connector.

## Innovation (blocked on owner env)

- #155 TLS-verify-by-default is the correct next Conduit hardening. Merge only after Render Postgres CA is set.
- Ready-identity stamp on Resonance `/api/ready` so Conduit hygiene can stop guessing dashboard vs process.
- Hygiene freeze until CHR-54 or CHR-55 moves.
