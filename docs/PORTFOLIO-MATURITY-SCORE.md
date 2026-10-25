# Portfolio maturity score (portfolio-probe)

`node scripts/portfolio-probe.mjs` prints a 0–10 score plus a per-target breakdown table; `--json` adds `scoreBreakdown` (`rows`, `byFactor`, `targets`, `score`).

The score is the **unweighted mean** of per-target points (each of the N targets weighs 1/N):

| Factor | Points | When |
|---|---|---|
| `ready` | 10 | outcome `ready` and ok |
| `known_owner_gate` | 6 | `not_ready` matching the pinned owner-gated missing set |
| `alias_absent` / `stranger_occupant` | 1 | Vercel alias 404, or someone else's app on the alias |
| `other_not_ok` | 2 | anything else (503 cold start, timeout, drift, shape change, unknown) |

## Why the 2026-10-25 02:00 ET pass scored 2.7/10

6 targets: Conduit cold 503 (2) + Resonance Netlify ready (10) + four Vercel alias rows (1 each) = 16 / 6 = **2.67 → 2.7**.
Four of six targets are third-party or absent aliases, so the score mostly measures alias drift, not service health. Live re-run at 06:10 ET with Conduit warm (200) still scored 2.7, because Conduit was classified `shape_changed` against schemas/ready/conduit-ready (2 points, same as a cold 503); fixing that shape drift would raise it to 18/6 = 3.0. This is a known limitation; any reweighting (for example excluding informational alias rows) should be a separate, explicit change.
