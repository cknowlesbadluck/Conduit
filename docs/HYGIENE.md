# Conduit hygiene — 2026-10-01 03:00 EDT

Live `GET /health` 200. `GET /ready` 200 version 0.8.0 persistence postgres.
MCP diagnostics: health, protected resource, authorization server, JWKS, scope parity, CIMD/DCR all ok.
Bound agent `grok`. bindingConflict false. `activity_prune` removed 0 rows.

Do not merge #119 or #120. They stay draft and red against an older base.
Do not merge #155 until Render TLS env is set.
Do not hard-code Resonance or Quicksilver into Conduit core.
Main remains `b582429b`.
