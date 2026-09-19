## 2025-03-09 - Pre-indexing activity streams in status projections
**Learning:** Status projections in `src/status.ts` were running nested $O(N \times M)$ searches across $N$ agents and $M$ activity events. Pre-indexing activity events into a `Map` or `Set` during a single $O(M)$ pass reduces matching to $O(N + M)$ without changing output semantics.
**Action:** When correlating collections in memory (e.g. agents to activity logs or tasks to projects), build single-pass Map/Set index structures before mapping or filtering over the primary collection.

## 2025-03-10 - Pre-normalizing invariant inputs in grant evaluation loops
**Learning:** `assertCapability` in `src/capabilities.ts` evaluated capability grants by calling `normalizePath` on `request.path` inside each iteration. For HTTP/HTTPS endpoint requests, `normalizePath` called `new URL(path)`, leading to redundant $O(G)$ URL instantiations per external call. Normalizing invariant request properties once before iteration eliminates repeated URL creation overhead.
**Action:** Pre-normalize invariant input parameters (e.g., URLs, paths, or search parameters) before passing them into loop predicate functions or matching logic.
