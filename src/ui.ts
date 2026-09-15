export const CONDUIT_UI_CSS = `
:root{color-scheme:dark;--bg:#0b0d10;--panel:#11151a;--line:#303840;--text:#e7edf2;--muted:#8d98a3;--active:#69d7a5;--danger:#e27676;--radius:6px}
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--bg);color:var(--text);font:14px/1.45 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace}body{padding:20px}button{font:inherit;color:inherit}a{color:inherit}.shell{max-width:1180px;margin:0 auto}.header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);padding:0 0 14px;margin-bottom:16px}.brand{font-weight:700;letter-spacing:.12em}.version{color:var(--muted);font-size:12px;margin-left:10px}.state{display:inline-flex;align-items:center;gap:8px;color:var(--muted);text-transform:uppercase;font-size:12px}.dot{width:7px;height:7px;border-radius:50%;background:var(--muted)}.dot.active{background:var(--active);box-shadow:0 0 8px color-mix(in srgb,var(--active) 65%,transparent)}.layout{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:14px}.panel{border:1px solid var(--line);background:var(--panel);border-radius:var(--radius)}.schematic{min-height:390px;padding:22px;position:relative;overflow:hidden}.schematic-head{display:flex;justify-content:space-between;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em}.diagram{min-height:320px;display:flex;align-items:center;justify-content:center;gap:36px;position:relative}.core{border:1px solid var(--line);padding:18px 24px;min-width:180px;text-align:center;background:#0d1115;position:relative;z-index:2}.core.active{border-color:var(--active);background:#0d1513}.core small{display:block;color:var(--muted);font-size:11px;margin-top:4px}.agents{display:flex;flex-direction:column;gap:10px;min-width:190px}.agent{display:grid;grid-template-columns:12px 1fr;gap:9px;align-items:center;border:1px solid var(--line);background:#0e1216;padding:10px 12px;text-align:left;cursor:pointer}.agent:hover,.agent:focus-visible{border-color:#59646e;outline:none}.agent.connected{border-color:#456d5c}.agent .pin{width:7px;height:7px;border-radius:50%;background:var(--muted)}.agent.connected .pin{background:var(--active)}.agent strong{display:block;font-size:13px}.agent span{display:block;color:var(--muted);font-size:11px;margin-top:2px}.wire{height:1px;width:36px;background:var(--line)}.wire.active{background:var(--active);box-shadow:0 0 7px color-mix(in srgb,var(--active) 35%,transparent)}.empty{border:1px dashed var(--line);padding:14px;color:var(--muted);font-size:12px}.details{padding:16px}.details h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 14px}.kv{display:grid;grid-template-columns:1fr;gap:10px}.kv div{border-top:1px solid var(--line);padding-top:9px}.kv label{display:block;color:var(--muted);font-size:10px;text-transform:uppercase;margin-bottom:3px}.kv strong{font-weight:500;overflow-wrap:anywhere}.sections{grid-column:1/-1;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.section{padding:14px;min-height:160px}.section h2{margin:0 0 12px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.list{display:flex;flex-direction:column;gap:7px}.row{border-top:1px solid var(--line);padding-top:7px}.row:first-child{border-top:0;padding-top:0}.row strong{display:block;font-size:12px;font-weight:500}.row span{display:block;color:var(--muted);font-size:10px;overflow-wrap:anywhere}.footer{color:var(--muted);font-size:10px;padding-top:12px}.error{color:var(--danger)}@media(max-width:860px){body{padding:12px}.layout{grid-template-columns:1fr}.sections{grid-column:auto;grid-template-columns:1fr 1fr}.diagram{gap:10px}.wire{width:18px}}@media(max-width:560px){.header{align-items:flex-start;gap:12px}.diagram{min-height:270px;flex-direction:column}.wire{width:1px;height:24px}.agents{width:100%;min-width:0}.core{order:0}.agents{order:1}.sections{grid-template-columns:1fr}.schematic{min-height:0}.details{min-height:0}}
`;

export const CONDUIT_UI_JS = `
(() => {
  const $ = (id) => document.getElementById(id);
  const text = (value) => document.createTextNode(value == null ? "" : String(value));
  const make = (tag, className, content) => { const node = document.createElement(tag); if (className) node.className = className; if (content !== undefined) node.appendChild(text(content)); return node; };
  const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };
  const formatTime = (value) => { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : date.toLocaleString(); };

  function showDetails(connection) {
    const panel = $("details");
    clear(panel);
    panel.appendChild(make("h2", null, "Inspection"));
    const grid = make("div", "kv");
    const values = [["Node", connection.label], ["Identifier", connection.id], ["State", connection.status], ["Last activity", formatTime(connection.lastActivity)]];
    values.forEach(([label, value]) => { const item = document.createElement("div"); item.appendChild(make("label", null, label)); item.appendChild(make("strong", null, value)); grid.appendChild(item); });
    panel.appendChild(grid);
  }

  function renderConnections(connections) {
    const host = $("agents");
    const summary = $("connections-summary");
    const wire = $("wire");
    const core = document.querySelector(".core");
    clear(host);
    clear(summary);
    const connected = connections.filter((connection) => connection.status === "connected").length;
    wire.className = "wire" + (connected ? " active" : "");
    core.className = "core" + (connected ? " active" : "");
    const summaryRow = make("div", "row");
    summaryRow.appendChild(make("strong", null, connections.length ? (connected + " connected / " + connections.length + " observed") : "No agents observed"));
    summaryRow.appendChild(make("span", null, "Derived from server activity"));
    summary.appendChild(summaryRow);
    if (!connections.length) { host.appendChild(make("div", "empty", "No agent connections observed.")); return; }
    connections.forEach((connection) => {
      const item = make("button", "agent" + (connection.status === "connected" ? " connected" : ""));
      item.type = "button";
      item.appendChild(make("span", "pin"));
      const copy = document.createElement("span");
      copy.appendChild(make("strong", null, connection.label));
      copy.appendChild(make("span", null, connection.status));
      item.appendChild(copy);
      item.addEventListener("click", () => showDetails(connection));
      host.appendChild(item);
    });
    showDetails(connections[0]);
  }

  function renderList(id, items, nameKey, secondaryKey) {
    const host = $(id); clear(host);
    if (!items.length) { host.appendChild(make("div", "empty", "None observed.")); return; }
    items.slice(0, 8).forEach((item) => {
      const row = make("div", "row");
      row.appendChild(make("strong", null, item[nameKey] ?? "Unnamed"));
      if (secondaryKey) row.appendChild(make("span", null, item[secondaryKey] ?? ""));
      host.appendChild(row);
    });
  }

  function renderActivity(items) {
    const host = $("activity"); clear(host);
    if (!items.length) { host.appendChild(make("div", "empty", "No activity recorded.")); return; }
    items.slice(0, 8).forEach((item) => { const row = make("div", "row"); row.appendChild(make("strong", null, item.type || "event")); row.appendChild(make("span", null, formatTime(item.at))); host.appendChild(row); });
  }

  function render(data) {
    $("version").textContent = data.version || "";
    $("service-state").textContent = data.status || "unknown";
    $("service-dot").className = "dot" + (data.status === "online" ? " active" : "");
    renderConnections(data.connections || []);
    renderList("tools", data.tools || [], "name", "description");
    renderList("tasks", data.tasks || [], "title", "status");
    renderActivity(data.activity || []);
  }

  async function load() {
    try {
      const response = await fetch("/status", { headers: { "Accept": "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error("status endpoint returned " + response.status);
      render(await response.json());
    } catch (error) {
      $("service-state").textContent = "degraded";
      $("service-dot").className = "dot";
      const details = $("details"); clear(details); details.appendChild(make("h2", null, "Inspection")); details.appendChild(make("div", "error", error instanceof Error ? error.message : "Unable to load status."));
    }
  }

  load();
  window.setInterval(load, 15000);
})();
`;

export function conduitUiHtml() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conduit</title><link rel="stylesheet" href="/ui.css"></head><body><main class="shell"><header class="header"><div><span class="brand">CONDUIT</span><span id="version" class="version"></span></div><div class="state"><span id="service-dot" class="dot"></span><span id="service-state">loading</span></div></header><div class="layout"><section class="panel schematic" aria-label="Conduit schematic"><div class="schematic-head"><span>system schematic</span><span>MCP transport</span></div><div class="diagram"><div id="agents" class="agents"><div class="empty">Loading connections…</div></div><div id="wire" class="wire" aria-hidden="true"></div><div class="core"><strong>CONDUIT</strong><small>MCP</small></div></div></section><aside id="details" class="panel details"><h2>Inspection</h2><div class="empty">Select a node.</div></aside><div class="sections"><section class="panel section"><h2>Connections</h2><div id="connections-summary" class="list"><div class="row"><strong>Loading</strong><span>Observed from server activity</span></div></div></section><section class="panel section"><h2>Tools</h2><div id="tools" class="list"><div class="empty">Loading…</div></div></section><section class="panel section"><h2>Tasks</h2><div id="tasks" class="list"><div class="empty">Loading…</div></div></section><section class="panel section"><h2>Activity</h2><div id="activity" class="list"><div class="empty">Loading…</div></div></section></div></div><div class="footer">Conduit operational view · read-only · <a href="/health">health</a> · <a href="/ready">ready</a> · <a href="/mcp">mcp</a></div></main><script src="/ui.js" defer></script></body></html>`;
}
