/**
 * Read-only stale-branch report: branches with no open PR (as head) and whose tip commit is 14+ days old.
 * Excludes the default branch. A branch that heads an open PR into any repository (via ref.associatedPullRequests) is protected. Fork (cross-repository) PR heads do not protect a same-named local branch. Never deletes or writes anything; never prints the token.
 */
export const STALE_DAYS = 14;

/** branches: [{name, committedAt}], openHeads: Set|array of head ref names. Pure. */
export function staleBranches(branches = [], openHeads = [], { now = Date.now(), days = STALE_DAYS, defaultBranch = "main" } = {}) {
  const heads = new Set(openHeads);
  const cutoff = now - days * 86_400_000;
  return branches
    .filter((b) => b && b.name !== defaultBranch && !heads.has(b.name))
    .filter((b) => { const t = Date.parse(b.committedAt); return Number.isFinite(t) && t <= cutoff; })
    .map((b) => ({ name: b.name, committedAt: b.committedAt, ageDays: Math.floor((now - Date.parse(b.committedAt)) / 86_400_000) }))
    .sort((a, b) => b.ageDays - a.ageDays || a.name.localeCompare(b.name));
}

const QUERY = `query($o:String!,$r:String!,$c:String){repository(owner:$o,name:$r){defaultBranchRef{name}
 refs(refPrefix:"refs/heads/",first:100,after:$c){pageInfo{hasNextPage endCursor} nodes{name associatedPullRequests(states:OPEN,first:1){totalCount} target{... on Commit{committedDate}}}}
 pullRequests(states:OPEN,first:100){totalCount nodes{headRefName isCrossRepository}}}}`;

/** Read-only GraphQL fetch. Returns null per repo without a token, on errors, or if open PRs are truncated. */
export async function fetchStaleBranches({ owner = "cknowlesbadluck", repos = ["QuicksilverV1", "Conduit", "Resonance"], token = process.env.GH_TOKEN, fetchImpl = fetch, now = Date.now(), timeoutMs = 15_000 } = {}) {
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
        for (const n of r.refs.nodes) branches.push({ name: n.name, committedAt: n.target?.committedDate });
        if (!r.refs.pageInfo.hasNextPage) { cursor = null; break; }
        cursor = r.refs.pageInfo.endCursor;
      }
      if (cursor) throw new Error("too many branches");
      out[repo] = staleBranches(branches, [...(heads ?? []), ...extraHeads], { now, defaultBranch: def });
    } catch { out[repo] = null; }
  }
  return out;
}
