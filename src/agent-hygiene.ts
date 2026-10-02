export type AgentHygiene = {
  clusters: string[][];
  advisory: string;
};

/**
 * Flag logical-agent splits that share a prefix before the first hyphen.
 * This is an advisory. It does not merge, delete, or rebind agents.
 * `grok` + `grok-xai` is the known production split and must stay visible.
 */
export function classifyAgentIds(ids: readonly string[]): AgentHygiene {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const prefix = id.split("-")[0];
    if (!prefix) continue;
    const current = groups.get(prefix) ?? [];
    current.push(id);
    groups.set(prefix, current);
  }
  const clusters = [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => [...group].sort())
    .sort((a, b) => a[0].localeCompare(b[0]));
  return {
    clusters,
    advisory: clusters.length === 0
      ? "no_prefix_splits"
      : "prefix_splits_are_advisory_do_not_rebind",
  };
}
