# Merge readiness (read-only)

`node scripts/merge-readiness.mjs <pr>... [--repo owner/name] [--json]` evaluates the owner's Conduit squash-merge criteria and prints READY or BLOCKED with reasons. It never merges, comments, resolves threads or dismisses reviews.

Blockers: never-merge list (#206 #212 #234 #238 #243 #209 #155 #120 #321), draft, base not `main`, not MERGEABLE, behind main (compare API `behind_by`), a standing CHANGES_REQUESTED (latest review per author, bots included), unresolved review threads, any non-green check other than `Workers Builds: conduit`, no checks, sensitive paths (auth, grants, migrations, secrets, .env, TLS, proxy/trust, render.yaml, workflows), and env-var mentions in the body. Unknown values fail closed.
