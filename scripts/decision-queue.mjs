/**
 * Read-only owner decision queue: open PRs that are blocked on an owner decision, by category.
 * Categories (a PR may appear in several):
 *   bot_only_approval  - approved, but every APPROVED review is from a bot (login ends in [bot] or is a known bot)
 *   changes_requested  - reviewDecision CHANGES_REQUESTED
 *   adds_env_vars      - patch adds a new process.env.NAME / env.NAME reference or a NAME= line in an .env* file
 *   auth_grants_paths  - touches a path containing auth, grant, rls, policy, or a migration
 *   behind_main        - mergeStateStatus BEHIND or DIRTY (needs rebase / conflicts)
 *   no_ci              - head commit has no check runs or statuses at all
 * Pure classifier + a fetcher that never writes, never prints the token, and returns null on error.
 */
export const BOT_LOGINS = new Set(["coderabbitai", "chatgpt-codex-connector", "copilot-pull-request-reviewer", "gemini-code-assist", "dependabot", "github-actions"]);
export const isBot = (login) => typeof login === "string" && (login.endsWith("[bot]") || BOT_LOGINS.has(login.replace(/\[bot\]$/, "")));
const AUTH_PATH = /(^|[/_.-])(auth|grants?|rls|polic(y|ies)|migrations?)([/_.-]|$)/i;
const ENV_ADD = /^\+(?!\+\+).*?(?:process\.env\.|\benv\.)([A-Z][A-Z0-9_]{2,})|^\+\s*([A-Z][A-Z0-9_]{2,})\s*=/;

export function addedEnvVars(files = []) {
  const added = new Set(), removed = new Set();
  for (const f of files) {
    const isEnvFile = /(^|\/)\.env[^/]*$/.test(f?.filename ?? "");
    for (const line of String(f?.patch ?? "").split("\n")) {
      const m = line.match(ENV_ADD);
      const name = m && (m[1] ?? (isEnvFile ? m[2] : undefined));
      if (name) added.add(name);
      const r = line.replace(/^-/, "+").match(ENV_ADD);
      if (line.startsWith("-") && !line.startsWith("---") && r) removed.add(r[1] ?? (isEnvFile ? r[2] : undefined));
    }
  }
  return [...added].filter((n) => !removed.has(n)).sort();
}

/** pr: { number, title, reviewDecision, mergeStateStatus, reviews:[{login,state}], files:[{filename,patch}], checkCount } */
export function classifyDecisions(pr) {
  const cats = [];
  const approvals = (pr.reviews ?? []).filter((r) => r.state === "APPROVED");
  if (approvals.length > 0 && approvals.every((r) => isBot(r.login))) cats.push("bot_only_approval");
  if (pr.reviewDecision === "CHANGES_REQUESTED") cats.push("changes_requested");
  const env = addedEnvVars(pr.files);
  if (env.length) cats.push("adds_env_vars");
  if ((pr.files ?? []).some((f) => AUTH_PATH.test(f.filename ?? ""))) cats.push("auth_grants_paths");
  if (pr.mergeStateStatus === "BEHIND" || pr.mergeStateStatus === "DIRTY") cats.push("behind_main");
  if (pr.checkCount === 0) cats.push("no_ci");
  return { number: pr.number, title: pr.title, categories: cats, envVars: env };
}

export function decisionQueue(prs) {
  const byCategory = { bot_only_approval: [], changes_requested: [], adds_env_vars: [], auth_grants_paths: [], behind_main: [], no_ci: [] };
  const items = prs.map(classifyDecisions);
  for (const it of items) for (const c of it.categories) byCategory[c].push(it.number);
  return { open: prs.length, blocked: items.filter((i) => i.categories.length).length, byCategory, items };
}

const QUERY = `query($o:String!,$r:String!){repository(owner:$o,name:$r){pullRequests(states:OPEN,first:100){totalCount nodes{number title reviewDecision mergeStateStatus
 latestReviews(first:20){nodes{state author{login}}}
 commits(last:1){nodes{commit{statusCheckRollup{contexts(first:1){totalCount}}}}}}}}}`;

/** Read-only. Token optional (GH_TOKEN); never logged. Returns null for a repo on any error or truncation. */
export async function fetchDecisionQueue({ owner = "cknowlesbadluck", repos = ["QuicksilverV1", "Conduit", "Resonance"], token = process.env.GH_TOKEN, fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
  const headers = { "User-Agent": "portfolio-probe", Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const out = {};
  for (const repo of repos) {
    try {
      const res = await fetchImpl("https://api.github.com/graphql", { method: "POST", headers, body: JSON.stringify({ query: QUERY, variables: { o: owner, r: repo } }), signal: AbortSignal.timeout(timeoutMs) });
      const data = res.ok ? await res.json() : null;
      const conn = data?.data?.repository?.pullRequests;
      if (!conn || conn.totalCount > conn.nodes.length) { out[repo] = null; continue; }
      const prs = [];
      for (const n of conn.nodes) {
        const fr = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/pulls/${n.number}/files?per_page=100`, { headers, signal: AbortSignal.timeout(timeoutMs) });
        const files = fr.ok ? await fr.json() : null;
        if (!Array.isArray(files)) throw new Error("files");
        const rollup = n.commits?.nodes?.[0]?.commit?.statusCheckRollup;
        prs.push({ number: n.number, title: n.title, reviewDecision: n.reviewDecision, mergeStateStatus: n.mergeStateStatus,
          reviews: (n.latestReviews?.nodes ?? []).map((r) => ({ login: r.author?.login, state: r.state })),
          files: files.map((f) => ({ filename: f.filename, patch: f.patch })), checkCount: rollup ? rollup.contexts.totalCount : 0 });
      }
      out[repo] = decisionQueue(prs);
    } catch { out[repo] = null; }
  }
  return out;
}
