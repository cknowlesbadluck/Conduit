## 2025-03-09 - Memoizing environment subject Sets and fast-pathing exact pattern matches
**Learning:** `isGrantAdmin` was instantiating and parsing `CONDUIT_GRANT_ADMIN_SUBJECTS` into a `Set` up to 5 times per call, and `matchPattern` was running `.split('/').filter(Boolean)` on every exact path match. Caching the parsed admin `Set` invalidated on env string changes and returning early on `normalizedPattern === normalizedValue` avoids repeated array/Set allocations on every authorization pass.
**Action:** Memoize environment variable parsing when used inside predicate or lookup functions, and add early-exit equality checks before running string splits or pattern matching logic.

## 2025-03-09 - Pre-indexing activity streams in status projections
**Learning:** Status projections in `src/status.ts` were running nested $O(N \times M)$ searches across $N$ agents and $M$ activity events. Pre-indexing activity events into a `Map` or `Set` during a single $O(M)$ pass reduces matching to $O(N + M)$ without changing output semantics.
**Action:** When correlating collections in memory (e.g. agents to activity logs or tasks to projects), build single-pass Map/Set index structures before mapping or filtering over the primary collection.

## 2025-03-09 - Fast-pathing URL redaction and single-pass status sanitization
**Learning:** `sanitizeActivity` in status projections was creating 3 intermediate arrays per event (`Object.entries` -> `.filter()` -> `.map()` -> `Object.fromEntries`) and running global RegExp matching on every property string. Fast-pathing URL checks by verifying string presence of query delimiters (`?`) before regex execution and using a single-pass `Object.keys` loop eliminates array allocations and skips unnecessary regex evaluations.
**Action:** When sanitizing objects or matching string patterns across large payload lists, fast-path mandatory token/delimiter presence checks before evaluating expensive RegExp matches, and use direct loop building instead of chaining array transformations.

## 2025-03-10 - Single-pass rate limiter eviction without sorting
**Learning:** `SlidingWindowLimiter.evict` was allocating entry tuples and calling `[...this.buckets.entries()].sort(...)` over all keys when `maxKeys` capacity was exceeded, creating $O(K \log K)$ sorting overhead and high garbage collection pressure on every rate-limited request. Replacing this with a single-pass $O(K)$ iteration that deletes expired buckets on the fly while tracking the oldest active key reduced eviction latency by >4x with zero array/tuple allocations.
**Action:** Avoid `[...map.entries()].sort()` for capacity eviction in high-throughput hot paths; use single-pass tracking loops to identify eviction candidates in $O(N)$ time with zero temporary array allocations.

## 2025-03-10 - Fast-path credential redaction and single-pass record sanitization
**Learning:** `redactString` was executing 11 regex replace operations on every string property across all logged activity events and record payloads. Pre-screening strings with a single `SECRET_TRIGGER` regex test before executing full regex replacements reduced redaction latency by >10x (from ~2.37s to ~0.22s per 100k calls) while replacing `Object.entries(data).slice(0, 500)` with an indexed `Object.keys` loop eliminated temporary tuple and slice array allocations.
**Action:** When running multi-regex string transformation pipelines on un-redacted strings, use a fast single-pass pre-check trigger to skip regex passes on safe inputs, and iterate keys directly to avoid entry tuple allocations.

## 2025-03-10 - Fast-path capability pattern matching and snapshotting event listeners
**Learning:** `matchPattern` in `src/capabilities.ts` was running `normalizePath` (and creating URL objects) even when pattern and value strings were strictly identical. Fast-pathing raw string equality `pattern === value` before path normalization reduced matching latency by ~7.7x (from 15.6ms to 2.0ms per 1M calls). Directly iterating live subscriber Sets in `publishEvent` without snapshotting (`[...listeners]`) was attempted for zero-allocation dispatching, but rejected due to re-entrancy mutation risks if a subscriber adds/removes listeners during callback execution.
**Action:** Fast-path strict equality checks on raw strings before executing string normalization or URL parsing, but preserve array snapshots `[...listeners]` when iterating active event subscriber collections to guarantee re-entrancy safety.
