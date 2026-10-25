/**
 * Read-only fail-closed auth-gate check (--auth-gate). Sends one unauthenticated request per
 * gated surface and expects 401/403. Anything else (2xx, 3xx, 404, 5xx, network error) is
 * reported as not gated. No credentials are sent or read; requests are non-mutating
 * (GET list, or MCP tools/list with no token).
 */
export const AUTH_GATE_TARGETS = Object.freeze([
  { name: "resonance-executions", method: "GET", url: "https://resonancenexus.netlify.app/api/nexus/executions" },
  { name: "conduit-mcp", method: "POST", url: "https://conduit-feco.onrender.com/mcp",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) },
]);

/** Pure: classify one observed status. */
export function classifyAuthGate(status) {
  if (status === 401 || status === 403) return { gated: true, reason: "rejected_unauthenticated" };
  if (typeof status !== "number") return { gated: false, reason: "unreachable" };
  if (status >= 200 && status < 300) return { gated: false, reason: "open_without_auth" };
  return { gated: false, reason: `unexpected_status_${status}` };
}

/** Pure: summarize. Fails closed: empty input is not ok. */
export function summarizeAuthGate(checks) {
  const open = checks.filter((c) => !c.gated).map((c) => c.name);
  return { ok: checks.length > 0 && open.length === 0, open, checks };
}

export async function runAuthGate(targets = AUTH_GATE_TARGETS, { fetchImpl = fetch, timeoutMs = 30_000 } = {}) {
  const checks = await Promise.all(targets.map(async (t) => {
    let status;
    try {
      const res = await fetchImpl(t.url, { method: t.method, headers: t.headers, body: t.body, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
      status = res.status;
    } catch { status = undefined; }
    return { name: t.name, status: status ?? null, ...classifyAuthGate(status) };
  }));
  return summarizeAuthGate(checks);
}
