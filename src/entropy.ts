export type EntropyDisposition = "keep" | "review" | "prune";

export interface EntropyRecord {
  repo: string;
  kind: "branch" | "pull";
  name: string;
  title?: string;
  draft?: boolean;
}

export interface EntropyDecision {
  disposition: EntropyDisposition;
  reason: string;
}

const KEEP_MARKER = /\b(KEEP RED|DO NOT MERGE|freeze)\b/i;
const DOCS_HYGIENE = /^docs\/hygiene-/i;
const HOURLY_AUDIT = /portfolio roadmap in place|PORTFOLIO-AUDIT-\d{4}/i;
const MICRO_OPT = /^(bolt\/|bolt-)/i;
const CODE_PREFIX = /^(feat|fix|harden|counsel)\//i;

export function classifyEntropy(record: EntropyRecord): EntropyDecision {
  const blob = `${record.name} ${record.title ?? ""}`;
  if (record.name === "main" || record.name === "master") {
    return { disposition: "keep", reason: "default branch" };
  }
  if (record.name === "release/0.8.0") {
    return { disposition: "keep", reason: "release line; do not delete until tagged" };
  }
  if (KEEP_MARKER.test(blob)) {
    return { disposition: "keep", reason: "explicit keep or freeze marker" };
  }
  if (DOCS_HYGIENE.test(record.name) || HOURLY_AUDIT.test(blob)) {
    return { disposition: "prune", reason: "superseded docs-only hygiene pass" };
  }
  if (MICRO_OPT.test(record.name)) {
    return { disposition: "review", reason: "micro-optimization; squash once or drop, do not stack" };
  }
  if (CODE_PREFIX.test(record.name)) {
    return { disposition: "review", reason: "code branch; merge only with green required checks" };
  }
  if (record.draft) {
    return { disposition: "review", reason: "draft; do not merge, do not treat as active work" };
  }
  return { disposition: "review", reason: "unclassified; never auto-prune" };
}

export function summarizeEntropy(records: readonly EntropyRecord[]): Record<EntropyDisposition, number> {
  const counts: Record<EntropyDisposition, number> = { keep: 0, review: 0, prune: 0 };
  for (const record of records) counts[classifyEntropy(record).disposition] += 1;
  return counts;
}
