export type CoordinationClass = "owner-blocked" | "audit-noise" | "frozen" | "agent-executable";

export interface CoordinationTask {
  title: string;
  description?: string;
  status?: string;
}

const OWNER_GATE = /^\s*GATE\b/i;
const AUDIT_NOISE = /^\s*AUDIT\b/i;
const FROZEN = /DO NOT MERGE|DRAFT KEEP RED|KEEP RED/i;

export function classifyCoordinationTask(task: CoordinationTask): CoordinationClass {
  const title = task.title ?? "";
  const description = task.description ?? "";
  const blob = `${title}\n${description}`;
  if (FROZEN.test(blob)) return "frozen";
  if (OWNER_GATE.test(title)) return "owner-blocked";
  if (AUDIT_NOISE.test(title)) return "audit-noise";
  return "agent-executable";
}

export function partitionCoordinationTasks<T extends CoordinationTask>(tasks: readonly T[]) {
  const buckets: Record<CoordinationClass, T[]> = {
    "owner-blocked": [],
    "audit-noise": [],
    frozen: [],
    "agent-executable": [],
  };
  for (const task of tasks) {
    buckets[classifyCoordinationTask(task)].push(task);
  }
  return {
    ...buckets,
    agentWorkCount: buckets["agent-executable"].length,
    ownerBlockedCount: buckets["owner-blocked"].length,
  };
}
