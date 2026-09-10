# Bolt's Performance Journal

## 2025-05-18 - Replacing Linear Binding Search in In-Memory Store with Reverse Index Map
**Learning:** Checking for agent subject bindings by iterating through `[...agentBindings.entries()].find()` causes `registerAgent` in in-memory mode to scale quadratically (O(N) per registration, overall O(N²)). Using a secondary Map `agentToSubject` turns reverse lookups into O(1).
**Action:** Maintain bidirectional index Maps for standard key-value relationships in in-memory fallback stores to prevent linear scans on frequent lookups or validations.
