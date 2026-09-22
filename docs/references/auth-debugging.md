# Auth debugging

Short operational notes for Conduit authentication and capability grants. Keep this file descriptive. Do not treat it as a substitute for `conduit_diagnostics` or live grant records.

## grant_create `pathPattern` is glob, not regex

`grant_create.pathPattern` is matched as a glob (`**`), not as a regular expression.

A leading `^` or trailing `.*` will silently never match. The grant is stored, but `integration_call` / `mcp_bridge_call` still return `capability_denied`.

Use a leading slash and `**` for prefix matches.

Wrong:

```text
^repos/cknowlesbadluck/Conduit.*
^repos/cknowlesbadluck/Conduit/git/refs/heads/.*
```

Right:

```text
/repos/cknowlesbadluck/Conduit/**
/repos/cknowlesbadluck/Conduit/git/refs/heads/**
```

Confirmed working examples (2026-09-22):

- `grant_90a41184` — `GET /repos/cknowlesbadluck/Conduit/**`
- `grant_2e22f93d` — `DELETE /repos/cknowlesbadluck/Conduit/git/refs/heads/**`

If a newly created grant still denies, check pattern syntax before assuming grant evaluation or `CONDUIT_GRANT_ADMIN_SUBJECTS` is broken.
