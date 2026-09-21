## 2025-03-09 - In-memory Map insertion order for O(1) rate limiter LRU eviction
**Learning:** `SlidingWindowLimiter` in `src/rate-limit.ts` was copying all Map entries into an array and running `sort()` on every key eviction when `maxKeys` was exceeded, causing $O(K \log K)$ CPU spikes under high key activity. Since JavaScript `Map` iterates keys in insertion/update order, re-inserting keys (`map.delete(key); map.set(key, val)`) on access maintains LRU order natively, allowing $O(1)$ eviction via `map.keys()`.
**Action:** Leverage JavaScript `Map` insertion order for LRU caching and rate limiting evictions instead of copying and sorting Map entries.

## 2025-03-09 - Pre-indexing activity streams in status projections
**Learning:** Status projections in `src/status.ts` were running nested $O(N \times M)$ searches across $N$ agents and $M$ activity events. Pre-indexing activity events into a `Map` or `Set` during a single $O(M)$ pass reduces matching to $O(N + M)$ without changing output semantics.
**Action:** When correlating collections in memory (e.g. agents to activity logs or tasks to projects), build single-pass Map/Set index structures before mapping or filtering over the primary collection.
