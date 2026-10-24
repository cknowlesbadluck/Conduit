/**
 * Read-only stale-branch report: branches with no open PR (as head) and whose tip commit is 14+ days old,
 * plus (any age) branches whose most recent PR is already MERGED or CLOSED (reason "pr_merged"/"pr_closed").
 * Excludes the default branch. A branch that heads an open PR into any repository (via ref.associatedPullRequests) is protected. Fork (cross-repository) PR heads do not protect a same-named local branch. Never deletes or writes anything; never prints the token.
 * For merged/closed-PR branches, a read-only REST compare sets aheadBy (commits not on the default branch) and safeDelete (true only when aheadBy === 0). Squash/rebase merges leave aheadBy > 0, so safeDelete is deliberately conservative.
 */
export const STALE_DAYS = 14;

/** branches: [{name, committedAt}], openHeads: Set|array of head ref names. Pure. */
export function staleBranches(branches = [], openHeads = [], { now = Date.now(), days = STALE_DAYS, defaultBranch = "main" } = {}) {
  const heads = new Set(openHeads);
  const cutoff = now - days * 86_400_000;
  return branches
    .filter((b) => b && b.name !== defaultBranch && !heads.has(b.name))
    .map((b) => {
      const t = Date.parse(b.committedAt);
      const old = Number.isFinite(t) && t <= cutoff;
      const pr = b.lastPr && Number.isInteger(b.lastPr.number) && (b.lastPr.state === "MERGED" || b.lastPr.state === "CLOSED") ? b.lastPr : null;
      if (!old && !pr) return null;
      return { name: b.name, committedAt: b.committedAt, ageDays: Number.isFinite(t) ? Math.floor((now - t) / 86_400_000) : null,
        reason: pr ? (pr.state === "MERGED" ? "pr_merged" : "pr_closed") : "age", ...(pr ? { pr: { number: pr.number, state: pr.state } } : {}) };
    })
    .filter(Boolean)
    .sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1) || a.name.localeCompare(b.name));
}

/** Pure: annotate entries with aheadBy and safeDelete (true only when the PR is merged/closed AND aheadBy === 0). Unknown ahead -> safeDelete false. */
export function markSafeDelete(entries = [], ahead = {}) {
  return entries.map((e) => {
    const a = Number.isInteger(ahead[e.name]) ? ahead[e.name] : null;
    const done = e.pr?.state === "MERGED" || e.pr?.state === "CLOSED";
    return { ...e, aheadBy: a, safeDelete: done && a === 0 };
  });
}

/** Read-only REST compare: commits on branch not reachable from default branch (null on any error). */
export async function aheadBy({ owner, repo, base, head, token, fetchImpl = fetch, timeoutMs = 15_000 }) {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
    const res = await fetchImpl(url, { headers: { authorization: `bearer ${token}`, accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const j = await res.json();
    return Number.isInteger(j?.ahead_by) ? j.ahead_by : null;
  } catch { return null; }
}

const QUERY = `query($o:String!,$r:String!,$c:String){repository(owner:$o,name:$r){defaultBranchRef{name}
 refs(refPrefix:"refs/heads/",first:100,after:$c){pageInfo{hasNextPage endCursor} nodes{name associatedPullRequests(states:OPEN,first:1){totalCount} lastPr:associatedPullRequests(states:[MERGED,CLOSED],first:1,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number state}} target{... on Commit{committedDate}}}}
 pullRequests(states:OPEN,first:100){totalCount nodes{headRefName isCrossRepository}}}}`;

/** Read-only GraphQL fetch. Returns null per repo without a token, on errors, or if open PRs are truncated. */
export async function fetchStaleBranches({ owner = "cknowlesbadluck", repos = ["QuicksilverV1", "Conduit", "Resonance"], token = process.env.GH_TOKEN, fetchImpl = fetch, now = Date.now(), timeoutMs = 15_000, compareBudgetMs = 60_000, clock = Date.now } = {}) {
  const out = {};
  for (const repo of repos) {
    if (!token) { out[repo] = null; continue; }
    try {
      const branches = []; let cursor = null, heads = null; const extraHeads = []; let def = "main";
      for (let page = 0; page < 20; page++) {
        const res = await fetchImpl("https://api.github.com/graphql", { method: "POST", headers: { authorization: `bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ query: QUERY, variables: { o: owner, r: repo, c: cursor } }), signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) throw new Error("http");
        const data = await res.json();
        if (data?.errors?.length) throw new Error("gql");
        const r = data?.data?.repository; if (!r) throw new Error("none");
        def = r.defaultBranchRef?.name ?? def;
        if (r.pullRequests.totalCount > r.pullRequests.nodes.length) throw new Error("truncated");
        heads = r.pullRequests.nodes.filter((n) => !n.isCrossRepository).map((n) => n.headRefName);
        for (const n of r.refs.nodes) if (n.associatedPullRequests?.totalCount > 0) extraHeads.push(n.name);
        for (const n of r.refs.nodes) branches.push({ name: n.name, committedAt: n.target?.committedDate, lastPr: n.lastPr?.nodes?.[0] ?? null });
        if (!r.refs.pageInfo.hasNextPage) { cursor = null; break; }
        cursor = r.refs.pageInfo.endCursor;
      }
      if (cursor) throw new Error("too many branches");
      const stale = staleBranches(branches, [...(heads ?? []), ...extraHeads], { now, defaultBranch: def });
      const ahead = {};
      const deadline = clock() + compareBudgetMs; // total per-repo budget; leftovers stay unknown (safeDelete false)
      for (const e of stale) {
        const left = deadline - clock();
        if (left <= 0) break;
        if (e.pr) ahead[e.name] = await aheadBy({ owner, repo, base: def, head: e.name, token, fetchImpl, timeoutMs: Math.min(timeoutMs, left) });
      }
      out[repo] = markSafeDelete(stale, ahead);
    } catch { out[repo] = null; }
  }
  return out;
}
