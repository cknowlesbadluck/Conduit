## 2025-05-18 - In-memory array log & lookup optimization
**Learning:** Appending in-memory logs with `array.unshift()` is $O(N)$ per log write and scales poorly as log history grows. Switching to `array.push()` with backward iteration for retrieval achieves $O(1)$ writes and $O(\text{limit})$ reads. In-memory bidirectional mapping (like agent ID to actor subject) should use a reverse Map to avoid $O(N)$ entry iterations.
**Action:** When working with append-only in-memory arrays and key lookups, use `push()` + backward iteration and dedicated secondary Map indices.
