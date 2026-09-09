## 2025-05-18 - In-memory event store activity list traversal
**Learning:** Inserting items at the start of an in-memory array using `unshift()` causes O(N) array copy operations on every event write. A better approach for in-memory append logs is to `push()` (O(1) amortized) and iterate backwards from the end of the array when serving `listActivity()` with a limit, stopping early as soon as `limit` items are found.
**Action:** When working with append-only in-memory event stores in Node.js, prefer `push()` + reverse loop over `unshift()` + `slice()`.
