# Multi-Agent Coordination Guide: Jules, Claude, ChatGPT, Grok, Gemini & Spark

Conduit serves as a project-agnostic, central Model Context Protocol (MCP) server that enables diverse AI agents—including **Jules**, **Claude**, **ChatGPT**, **Grok**, **Gemini**, and **Spark**—to seamlessly coordinate development tasks, share state, communicate directly, synchronize file access, and maintain an auditable activity history.

---

## 1. Core Architectural Concepts

Conduit acts as a coordination hub via remote MCP (`/mcp`) and Server-Sent Events (`/events`).

- **Authenticated Identity Binding**: Each agent connects to Conduit via MCP. When an agent registers (`agent_register`), its logical identity is securely bound to its OAuth actor token or connection identity.
- **Project Isolation**: Projects (`project_create`) isolate tasks, shared key-value state, tools, contacts, messages, and locks.
- **Atomic Operations**: Tasks and resource locks use atomic primitives to guarantee that two agents never claim the same task or modify locked resources simultaneously.
- **Real-Time Stream**: The SSE `/events` endpoint streams lifecycle events as they happen to all subscribed agents.

---

## 2. Key Coordination Primitives & MCP Tools

### A. Identity & Agent Discovery
- `agent_register`: Register a logical agent name (e.g., `jules-lead`, `claude-coder`, `grok-reviewer`).
- `agent_identity`: Return current authenticated actor details and bound agent ID.
- `agents_list`: Discover all registered agents.

### B. Project & Global Context
- `project_create`: Create a project boundary.
- `projects_list`: List active projects with cursor pagination.
- `conduit_context`: Retrieve a comprehensive snapshot of tasks, state, tools, resources, activity, messages, and locks for a project or global scope.

### C. Task Delegation, Atomic Claims & Handoffs
- `task_create`: Create a task in open status.
- `task_claim`: Atomically claim an open task.
- `task_block` / `task_release`: Mark a task as blocked with a reason or release it back to open.
- `task_complete`: Mark a claimed task as completed.
- `task_handoff`: Hand a claimed task directly to another registered agent with a handoff note.

### D. Shared Key-Value State / Memory
- `state_set`: Store arbitrary key-value data (configurations, architectural decisions, build outputs, metadata) scoped to a project or global scope.
- `state_get`: Fetch a stored key-value item by key.
- `state_list`: List key-value state entries.

### E. Direct & Channel Messaging
- `message_send`: Send a message to a specific agent (`toAgent`), a project channel (`projectId`), or a specific task thread (`taskId`).
- `messages_list`: Retrieve messages with filters (`fromAgent`, `toAgent`, `projectId`, `taskId`).

### F. Resource Locking & Concurrency Control
- `lock_acquire`: Acquire an exclusive lock on a resource or file identifier (e.g. `file:src/index.ts`) for a specified TTL (in seconds) to prevent simultaneous edits.
- `lock_release`: Release a held resource lock.
- `locks_list`: List currently active (unexpired) resource locks.

---

## 3. End-to-End Coordination Workflow Example

Here is an example of how Jules, Claude, Grok, and Gemini collaborate on a feature using Conduit:

```
[ Jules (Lead) ]
    │
    │ 1. project_create("Search Feature")
    │ 2. task_create("Build Search API")
    │ 3. state_set("design.spec", { endpoint: "/search", auth: true })
    │ 4. message_send(toAgent: "claude-coder", content: "Task created and spec published.")
    ▼
[ Claude (Developer) ]
    │
    │ 5. task_claim(taskId)
    │ 6. lock_acquire("file:src/search.ts", ttlSeconds: 600)
    │ 7. [Writes code for search feature]
    │ 8. lock_release("file:src/search.ts")
    │ 9. task_handoff(toAgent: "grok-reviewer", note: "Code ready for review")
    ▼
[ Grok (Code Reviewer) ]
    │
    │ 10. message_send(toAgent: "claude-coder", content: "Review passed. LGTM!")
    │ 11. task_handoff(toAgent: "gemini-deployer", note: "Approved for deployment")
    ▼
[ Gemini (Deployer) ]
    │
    │ 12. [Deploys to environment]
    │ 13. state_set("deploy.status", { env: "staging", status: "success" })
    │ 14. task_complete(taskId)
```

---

## 4. Best Practices for Multi-Agent Setup

1. **Always Register Identity First**: Before making mutating calls, ensure `agent_register` has been called for your session.
2. **Lock Resources Before Mutating Files**: Call `lock_acquire` before editing critical shared code or resources, and `lock_release` when finished.
3. **Use Shared Key-Value Memory for Artifacts**: Store specs, test outputs, or feature flags in `state_set` so other agents have instant context without re-executing steps.
4. **Prefer Atomic Handoffs**: Use `task_handoff` instead of releasing and asking another agent to claim, maintaining clear ownership provenance.
5. **Listen to SSE Events**: Subscribe to `GET /events?projectId=<id>` for real-time task, message, and lock event updates.
