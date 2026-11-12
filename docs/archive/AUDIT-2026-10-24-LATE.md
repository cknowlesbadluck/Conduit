# Conduit audit: 2026-10-24 late (6 PM ET / 22:00Z)

## Probes
- `GET https://conduit-feco.onrender.com/ready`: 200, `status=ready`, version 0.8.0, `contractRevision=2026-10-03-ready-surface`, persistence postgres.
- Conduit `/ready` does not include a `production` field (Resonance's does). This matters for the planned consistency check (slice c below).

## CI on main
- `f00887b` (body-parser 2.4.0 bump, #306): CI success, Live Smoke success, portfolio-probe (report-only) success.

## Entropy
- Open PRs went from 25 to 14 today.
- Remaining open PRs: #302, #305, #307, #308 (probe features, under review), #309 (entropy trend), #275 and #204 (perf), and #243, #238, #234, #212, #209, #206 (security/auth hardening). #155 (DB TLS) is waiting on a Render env change by the owner. #120 is a migrations draft that is meant to stay red.
- No docs-only PRs were left to prune.

## Owner gates (unchanged)
- #155 needs the Render DB TLS env set first. #120 needs a migrations decision.
- Device evidence CHR-55: still not_recorded.

## Innovations (no owner gates; none of them duplicate `--entropy`, `--stale-branches`, or `--consistency`)
1. **Entropy trend** (#309): `scripts/entropy-trend.mjs` compares current counts against `docs/baselines/pr-entropy-baseline.json` and fails if any repo grows by more than N (default 3).
2. **Stricter stale-branch safe-delete**: on top of the existing squash-aware check, also require no open PR from forks and an age of more than 3 days, and print a ready-to-run `git push origin <sha>:refs/heads/<branch>` restore command for each branch.
3. **Consistency strengthening**: assert that `contractRevision` matches `^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$` and that both planes report `production=true`. Conduit `/ready` would need to expose `production` first, which is a separate small PR.
