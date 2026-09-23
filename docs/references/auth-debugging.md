# Auth debugging

Short operational notes for Conduit authentication and capability grants. Keep this file descriptive. Do not treat it as a substitute for `conduit_diagnostics` or live grant records.

## grant_create `pathPattern` is glob, not regex

`grant_create.pathPattern` is matched as a glob, not as a regular expression.

Supported forms:

| Pattern | Meaning |
|---------|---------|
| `/exact/path` | Exact path only |
| `/repos/*/name` | Single segment wildcard |
| `/prefix/**` | Path equals prefix or is under it (preferred for service trees) |
| `/prefix*` | Path equals or starts with the literal prefix before `*` |

A leading `^` or trailing `.*` (regex style) will silently never match. The grant is stored, but `integration_call` / `mcp_bridge_call` still return `capability_denied`.

Wrong:

```text
^repos/cknowlesbadluck/Conduit.*
^repos/cknowlesbadluck/Conduit/git/refs/heads/.*
```

Right:

```text
/repos/cknowlesbadluck/Conduit/**
/repos/cknowlesbadluck/Conduit/git/refs/heads/**
/v1/services/srv-dabgm3ks728c739rmt50*
/v1/services/srv-dabgm3ks728c739rmt50/**
```

Confirmed working examples:

- `GET /repos/cknowlesbadluck/Conduit/**`
- `DELETE /repos/cknowlesbadluck/Conduit/git/refs/heads/**`
- `GET /v1/services/srv-dabgm3ks728c739rmt50*` (trailing single-star prefix)

If a newly created grant still denies, check pattern syntax before assuming grant evaluation or `CONDUIT_GRANT_ADMIN_SUBJECTS` is broken.
