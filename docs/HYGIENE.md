# Docs hygiene

Update `docs/AUDIT-2026-09-25.md` in place. Do not add hourly PORTFOLIO-AUDIT-HHMM files.
Freeze: do not merge #119 or #120 while they are marked KEEP RED.
Do not merge #132 without a recut that keeps O(K log K) for large excess and drops the wrangler change.
`.github/workflows/docs-hygiene.yml` fails the PR if hourly audit files reappear.
