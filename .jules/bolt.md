## 2025-03-09 - Pre-normalizing request attributes in capability assertions
**Learning:** `assertCapability` in `src/capabilities.ts` evaluated capability request attributes (`method`, `path`, timestamp) repeatedly per grant in `grants.some(...)`, causing redundant $O(N)$ string transformations, URL parsing, and `Date.now()` allocations.
**Action:** When validating collection items against a common request object, pre-normalize request attributes once before filtering or iterating through candidate items.

## 2025-03-09 - Pre-indexing activity streams in status projections
**Learning:** Status projections in `src/status.ts` were running nested $O(N \times M)$ searches across $N$ agents and $M$ activity events. Pre-indexing activity events into a `Map` or `Set` during a single $O(M)$ pass reduces matching to $O(N + M)$ without changing output semantics.
**Action:** When correlating collections in memory (e.g. agents to activity logs or tasks to projects), build single-pass Map/Set index structures before mapping or filtering over the primary collection.
