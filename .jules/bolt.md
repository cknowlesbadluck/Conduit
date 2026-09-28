## 2025-03-09 - Memoizing environment subject Sets and fast-pathing exact pattern matches
**Learning:** `isGrantAdmin` was instantiating and parsing `CONDUIT_GRANT_ADMIN_SUBJECTS` into a `Set` up to 5 times per call, and `matchPattern` was running `.split('/').filter(Boolean)` on every exact path match. Caching the parsed admin `Set` invalidated on env string changes and returning early on `normalizedPattern === normalizedValue` avoids repeated array/Set allocations on every authorization pass.
**Action:** Memoize environment variable parsing when used inside predicate or lookup functions, and add early-exit equality checks before running string splits or pattern matching logic.

## 2025-03-09 - Pre-indexing activity streams in status projections
**Learning:** Status projections in `src/status.ts` were running nested $O(N \times M)$ searches across $N$ agents and $M$ activity events. Pre-indexing activity events into a `Map` or `Set` during a single $O(M)$ pass reduces matching to $O(N + M)$ without changing output semantics.
**Action:** When correlating collections in memory (e.g. agents to activity logs or tasks to projects), build single-pass Map/Set index structures before mapping or filtering over the primary collection.

## 2025-03-09 - Fast-pathing URL redaction and single-pass status sanitization
**Learning:** `sanitizeActivity` in status projections was creating 3 intermediate arrays per event (`Object.entries` -> `.filter()` -> `.map()` -> `Object.fromEntries`) and running global RegExp matching on every property string. Fast-pathing URL checks by verifying string presence of query delimiters (`?`) before regex execution and using a single-pass `Object.keys` loop eliminates array allocations and skips unnecessary regex evaluations.
**Action:** When sanitizing objects or matching string patterns across large payload lists, fast-path mandatory token/delimiter presence checks before evaluating expensive RegExp matches, and use direct loop building instead of chaining array transformations.
