/**
 * Portfolio saturation witness.
 * Decides whether another pull request is allowed, and which same-repo
 * witnesses should collapse into the newest survivor.
 * Callers pass probe facts and open-pull metadata. This module never
 * accepts or emits secret values — only missing key names and pull titles.
 */

export const SATURATION_BUDGET = {
  maxOpenWitnessPulls: 3,
  maxOpenProductPulls: 2,
} as const;

export const ROADMAP_PHASES = [
  { id: 0, name: "inventory", exit: "Every live project is named and has a source of truth." },
  { id: 1, name: "liveness", exit: "Health probes are HTTP 200." },
  { id: 2, name: "readiness", exit: "Ready probes are HTTP 200 and name no missing required config." },
  { id: 3, name: "contract_parity", exit: "Live contract revision matches the expected stamp." },
  { id: 4, name: "hygiene", exit: "Orphan branches are gone. Keep-red pulls stay unmerged." },
  { id: 5, name: "owner_gate", exit: "No owner-only gate remains (secret, device proof, archive)." },
  { id: 6, name: "ci_green", exit: "Required CI on the candidate is green." },
  { id: 7, name: "merged_slice", exit: "The candidate slice is merged. Witness stacks are not product." },
  { id: 8, name: "proof", exit: "Production or device proof is recorded. Simulator is not proof." },
  { id: 9, name: "steady", exit: "No open blocker. Retired repos land here only when archived." },
] as const;

export type RoadmapPhaseId = (typeof ROADMAP_PHASES)[number]["id"];
export type PullKind = "keep-red" | "witness" | "product" | "dependabot";

export type OpenPull = {
  repo: string;
  number: number;
  title: string;
  draft: boolean;
  head: string;
};

export type ProjectProbe = {
  id: string;
  healthStatus?: number;
  readyStatus?: number;
  missingRequired?: string[];
  omittedFields?: string[];
  ownerGates?: string[];
  orphanBranches?: number;
};

export type SaturationInput = {
  pulls: OpenPull[];
  projects: ProjectProbe[];
  budget?: { maxOpenWitnessPulls: number; maxOpenProductPulls: number };
};

export type ClassifiedPull = OpenPull & { kind: PullKind; mergeable: false | "only-if-green" };

export type PhaseStatus = {
  id: RoadmapPhaseId;
  name: string;
  exit: string;
  status: "done" | "blocked" | "open";
  blocker: string | null;
};

export type CollapseDecision = {
  survivor: number | null;
  collapseCandidates: number[];
  protected: number[];
  reason: string;
};

export type SaturationVerdict = {
  witnessOpen: number;
  productOpen: number;
  keepRedOpen: number;
  dependabotOpen: number;
  admitAnotherWitness: boolean;
  admitAnotherProduct: boolean;
  doNotMerge: number[];
  doNotClose: number[];
  collapse: CollapseDecision;
  ownerActions: string[];
  agentActions: string[];
  pulls: ClassifiedPull[];
  roadmap: PhaseStatus[];
  secretsInvented: false;
};

const KEY_NAME = /^[A-Z][A-Z0-9_]{2,80}$/;

function keyNames(names: string[] | undefined): string[] {
  return (names ?? []).filter((name) => KEY_NAME.test(name));
}

export function classifyPull(pull: OpenPull): PullKind {
  const title = pull.title.toLowerCase();
  const head = pull.head.toLowerCase();
  if (
    title.includes("do not merge") ||
    title.includes("keep red") ||
    head.startsWith("codex/") ||
    head.includes("db-tls") ||
    head.includes("ssl-and-signed-cursors")
  ) {
    return "keep-red";
  }
  if (head.startsWith("dependabot/")) return "dependabot";
  if (
    head.startsWith("harden/") ||
    title.includes("witness") ||
    title.includes("phase machine") ||
    title.includes("admission budget")
  ) {
    return "witness";
  }
  return "product";
}

function phaseStatus(
  id: RoadmapPhaseId,
  reached: boolean,
  blocked: boolean,
  blocker: string | null,
): PhaseStatus {
  const phase = ROADMAP_PHASES[id];
  return {
    id,
    name: phase.name,
    exit: phase.exit,
    status: reached ? "done" : blocked ? "blocked" : "open",
    blocker: reached ? null : blocker,
  };
}

export function buildRoadmap(projects: ProjectProbe[]): PhaseStatus[] {
  const named = projects.length > 0 && projects.every((project) => project.id.trim().length > 0);
  const live = projects.filter((project) => (project.healthStatus ?? 0) === 200);
  const missing = projects.flatMap((project) => keyNames(project.missingRequired));
  const ready =
    projects.length > 0 &&
    projects.every((project) => project.readyStatus === 200 && keyNames(project.missingRequired).length === 0);
  const omitted = projects.flatMap((project) => project.omittedFields ?? []);
  const orphans = projects.reduce((sum, project) => sum + (project.orphanBranches ?? 0), 0);
  const gates = projects.flatMap((project) => project.ownerGates ?? []).filter((gate) => gate.trim().length > 0);

  const phases: PhaseStatus[] = [];
  phases.push(phaseStatus(0, named, !named, named ? null : "unnamed project"));
  phases.push(phaseStatus(1, live.length === projects.length && named, named && live.length !== projects.length, "health is not 200"));
  phases.push(
    phaseStatus(
      2,
      ready,
      !ready && missing.length > 0,
      missing.length > 0 ? `owner must set ${missing.join(", ")}` : "ready is not 200",
    ),
  );
  phases.push(
    phaseStatus(
      3,
      ready && omitted.length === 0,
      ready && omitted.length > 0,
      omitted.length > 0 ? `live body omits ${omitted.join(", ")}` : "contract not comparable until ready",
    ),
  );
  phases.push(phaseStatus(4, orphans === 0, orphans > 0, orphans > 0 ? `${orphans} orphan branch(es)` : null));
  phases.push(
    phaseStatus(
      5,
      gates.length === 0 && missing.length === 0,
      gates.length > 0 || missing.length > 0,
      gates[0] ?? (missing[0] ? `set ${missing[0]}` : null),
    ),
  );
  phases.push(phaseStatus(6, false, true, "required CI not proven on this witness"));
  phases.push(phaseStatus(7, false, true, "witness slices stay unmerged until required CI is green"));
  phases.push(phaseStatus(8, false, true, "device or production proof is an owner gate"));
  phases.push(phaseStatus(9, false, true, "steady state requires archive, secret, and proof gates closed"));
  return phases;
}

export function collapseWitnesses(pulls: OpenPull[]): CollapseDecision {
  const classified = pulls.map((pull) => ({ ...pull, kind: classifyPull(pull) }));
  const byRepo = new Map<string, Array<(typeof classified)[number]>>();
  for (const pull of classified) {
    if (pull.kind !== "witness") continue;
    const group = byRepo.get(pull.repo) ?? [];
    group.push(pull);
    byRepo.set(pull.repo, group);
  }
  const collapseCandidates: number[] = [];
  let survivor: number | null = null;
  for (const group of byRepo.values()) {
    const ordered = [...group].sort((left, right) => right.number - left.number);
    if (survivor === null || ordered[0].number > survivor) survivor = ordered[0].number;
    for (const older of ordered.slice(1)) collapseCandidates.push(older.number);
  }
  const protectedPulls = classified
    .filter((pull) => pull.kind !== "witness")
    .map((pull) => pull.number);
  return {
    survivor,
    collapseCandidates,
    protected: protectedPulls,
    reason: collapseCandidates.length
      ? "older same-repo witnesses are collapse candidates; do not close them until their modules are folded into the survivor"
      : "no same-repo witness stack to collapse",
  };
}

export function classifySaturation(input: SaturationInput): SaturationVerdict {
  const budget = input.budget ?? SATURATION_BUDGET;
  const pulls = input.pulls.map((pull) => {
    const kind = classifyPull(pull);
    const mergeable = kind === "keep-red" || kind === "witness" ? false : "only-if-green";
    return { ...pull, kind, mergeable } as ClassifiedPull;
  });
  const witnessOpen = pulls.filter((pull) => pull.kind === "witness").length;
  const productOpen = pulls.filter((pull) => pull.kind === "product").length;
  const keepRedOpen = pulls.filter((pull) => pull.kind === "keep-red").length;
  const dependabotOpen = pulls.filter((pull) => pull.kind === "dependabot").length;
  const missing = input.projects.flatMap((project) => keyNames(project.missingRequired));
  const gates = input.projects.flatMap((project) => project.ownerGates ?? []).filter((gate) => gate.trim().length > 0);
  const collapse = collapseWitnesses(input.pulls);
  const ownerActions = [
    ...missing.map((name) => `set required config by name only: ${name}`),
    ...gates,
  ];
  const agentActions = [
    "do not invent secret values",
    "do not merge keep-red pulls",
    "do not merge a witness while required CI is red or absent",
    "do not close keep-red, product, or dependabot pulls as hygiene",
  ];
  if (missing.length > 0) {
    agentActions.push("a 503 that names a missing key is an owner gate, not an implementation task");
  }
  const admitAnotherWitness = witnessOpen < budget.maxOpenWitnessPulls;
  const admitAnotherProduct =
    productOpen < budget.maxOpenProductPulls && missing.length === 0 && gates.length === 0;
  if (!admitAnotherWitness) agentActions.push("witness budget full; refresh the survivor instead of opening another");
  if (collapse.collapseCandidates.length > 0) {
    agentActions.push(`collapse candidates ${collapse.collapseCandidates.join(", ")} into survivor ${collapse.survivor}; do not close until folded`);
  }
  if (!admitAnotherProduct) agentActions.push("product budget or owner gate blocks another product pull");

  return {
    witnessOpen,
    productOpen,
    keepRedOpen,
    dependabotOpen,
    admitAnotherWitness,
    admitAnotherProduct,
    doNotMerge: pulls.filter((pull) => pull.mergeable === false).map((pull) => pull.number),
    doNotClose: collapse.protected,
    collapse,
    ownerActions,
    agentActions,
    pulls,
    roadmap: buildRoadmap(input.projects),
    secretsInvented: false,
  };
}
