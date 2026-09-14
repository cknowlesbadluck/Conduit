import { escapeHtml } from "./escape.js";
import type { StationSnapshot } from "./data.js";
import { VERSION, SERVICE_NAME } from "../version.js";

function statusClass(status: string): string {
  switch (status) {
    case "open":
      return "st-open";
    case "claimed":
      return "st-claimed";
    case "blocked":
      return "st-blocked";
    case "completed":
      return "st-done";
    default:
      return "";
  }
}

function renderTasks(snapshot: StationSnapshot): string {
  if (snapshot.tasks.length === 0) {
    return `<p class="empty">No tasks.</p>`;
  }
  const rows = snapshot.tasks
    .map((t) => {
      return `<tr>
  <td><code>${escapeHtml(t.id)}</code></td>
  <td><span class="pill ${statusClass(t.status)}">${escapeHtml(t.status)}</span></td>
  <td>${escapeHtml(t.title)}</td>
  <td>${escapeHtml(t.projectId ?? "—")}</td>
  <td>${escapeHtml(t.createdBy)}</td>
  <td>${escapeHtml(t.claimedBy ?? "—")}</td>
  <td>${escapeHtml(t.updatedAt)}</td>
</tr>`;
    })
    .join("\n");
  return `<table>
<thead><tr><th>ID</th><th>Status</th><th>Title</th><th>Project</th><th>Created by</th><th>Claimed by</th><th>Updated</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`;
}

function renderGrants(snapshot: StationSnapshot): string {
  if (snapshot.grantsNote) {
    return `<p class="empty">${escapeHtml(snapshot.grantsNote)}</p>`;
  }
  if (snapshot.grants.length === 0) {
    return `<p class="empty">No active grants in scope.</p>`;
  }
  const rows = snapshot.grants
    .map((g) => {
      return `<tr>
  <td><code>${escapeHtml(g.id)}</code></td>
  <td>${escapeHtml(g.agentId)}</td>
  <td>${escapeHtml(g.provider)}</td>
  <td><code>${escapeHtml(g.method)}</code></td>
  <td><code>${escapeHtml(g.pathPattern)}</code></td>
  <td>${escapeHtml(g.projectId ?? "—")}</td>
  <td>${escapeHtml(g.expiresAt ?? "—")}</td>
  <td>${escapeHtml(g.createdBy)}</td>
</tr>`;
    })
    .join("\n");
  return `<table>
<thead><tr><th>ID</th><th>Agent</th><th>Provider</th><th>Method</th><th>Path</th><th>Project</th><th>Expires</th><th>Created by</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`;
}

export function renderStationPage(snapshot: StationSnapshot): string {
  const projectLine = snapshot.projectId
    ? `Project filter: <code>${escapeHtml(snapshot.projectId)}</code>`
    : "All projects (tasks); grants scoped to your bound agent.";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(SERVICE_NAME)} Station</title>
<style>
:root {
  color-scheme: dark;
  --bg: #0b0c0d;
  --surface: #141618;
  --border: #2a2e33;
  --fg: #e8eaed;
  --muted: #9aa0a6;
  --accent: #c9d4dc;
  --open: #5b8def;
  --claimed: #c9a227;
  --blocked: #e06c75;
  --done: #7d9b76;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  line-height: 1.45;
  min-height: 100vh;
}
header {
  border-bottom: 1px solid var(--border);
  padding: 1rem 1.25rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.5rem;
  align-items: baseline;
  justify-content: space-between;
  background: var(--surface);
}
header h1 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
header .meta { color: var(--muted); font-size: 0.85rem; }
main { padding: 1.25rem; max-width: 1200px; margin: 0 auto; }
section {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem 1.1rem 1.15rem;
  margin-bottom: 1.25rem;
}
section h2 {
  margin: 0 0 0.75rem;
  font-size: 0.95rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--accent);
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
th, td {
  text-align: left;
  padding: 0.45rem 0.5rem;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
th { color: var(--muted); font-weight: 500; }
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.8rem;
  word-break: break-all;
}
.pill {
  display: inline-block;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  font-size: 0.75rem;
  border: 1px solid var(--border);
}
.st-open { color: var(--open); border-color: var(--open); }
.st-claimed { color: var(--claimed); border-color: var(--claimed); }
.st-blocked { color: var(--blocked); border-color: var(--blocked); }
.st-done { color: var(--done); border-color: var(--done); }
.empty { color: var(--muted); margin: 0.25rem 0; }
.note { color: var(--muted); font-size: 0.85rem; margin: 0 0 0.75rem; }
@media (max-width: 720px) {
  table, thead, tbody, th, td, tr { display: block; }
  thead { display: none; }
  tr { border-bottom: 1px solid var(--border); padding: 0.5rem 0; }
  td { border: none; padding: 0.15rem 0; }
  td::before { content: attr(data-label); display: none; }
}
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(SERVICE_NAME)} Station</h1>
  <div class="meta">
    v${escapeHtml(VERSION)} · ${escapeHtml(snapshot.generatedAt)}
    ${snapshot.boundAgentId ? ` · agent <code>${escapeHtml(snapshot.boundAgentId)}</code>` : ""}
  </div>
</header>
<main>
  <p class="note">${projectLine} · Monitor only (no actions). Refresh to reload. Auth: <code>Authorization: Bearer …</code></p>
  <section>
    <h2>Tasks <span class="meta">(${snapshot.tasks.length})</span></h2>
    ${renderTasks(snapshot)}
  </section>
  <section>
    <h2>Grants <span class="meta">(${snapshot.grants.length})</span></h2>
    ${renderGrants(snapshot)}
  </section>
</main>
</body>
</html>`;
}
