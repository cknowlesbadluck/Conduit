// Read-only cross-repo consistency check: does what the docs claim match live evidence?
//  - readiness contract revisions: live /ready `contractRevision` vs the probe's pins (Conduit pin,
//    Resonance main parity) and owner-gate stamps (Resonance ownerActionRequired / ownerKeys / missingRequired);
//  - roadmap phase statuses in Resonance docs/PORTFOLIO-ROADMAP-10-PHASE.md vs the evidence each phase names.
// Fail-closed: unreadable roadmap, unparseable phases, or missing evidence is a problem, never "consistent".
// A phase claimed [passed] without passing evidence is a contradiction (problem). Evidence that already
// passes while the doc says otherwise is reported as `stale` (informational). Never writes anything.
import { TARGETS, RESONANCE_MAIN_READY } from "./portfolio-probe.mjs";

export const PR_TARGET = 10;
const STATUS = /\[(passed|in progress|blocked)\]/i;

/**
 * Pure. Parse the first (current) phases table — header `| # | Phase | ... | Status |` — row by row
 * until the table ends; later historical tables are ignored. Returns [] when no such table parses.
 */
export function parsePhases(md) {
  const out = [];
  const lines = String(md ?? "").split("\n");
  const h = lines.findIndex((l) => /^\|\s*#\s*\|\s*Phase\s*\|.*\|\s*Status\s*\|\s*$/i.test(l));
  if (h < 0) return out;
  for (let i = h + 2; i < lines.length && lines[i].startsWith("|"); i++) {
    const line = lines[i];
    const m = /^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|.*\|\s*([^|]*)\|\s*$/.exec(line);
    if (!m) { out.push({ n: null, name: line.slice(0, 60), status: "unparseable" }); continue; } // fail closed, never skip
    const s = STATUS.exec(m[3]);
    out.push({ n: Number(m[1]), name: m[2], status: s ? s[1].toLowerCase() : "unknown" });
  }
  return out;
}

const pinOf = (name) => TARGETS.find((t) => t.name === name)?.expect?.contractRevision;

/**
 * Pure. `live`: { conduit: readyBody|null, resonance: readyBody|null, unauthPostStatus: number|null,
 * openPrs: { repo: n|null } }. `roadmap`: markdown or null.
 */
export function checkConsistency({ live, roadmap }) {
  const problems = [], stale = [], checks = [];
  const c = live?.conduit, r = live?.resonance;
  const conduitPin = pinOf("conduit"), resonancePin = RESONANCE_MAIN_READY.contractRevision;
  const revOk = {
    conduit: Boolean(c) && c.contractRevision === conduitPin,
    resonance: Boolean(r) && r.contractRevision === resonancePin,
  };
  for (const [name, body, pin] of [["conduit", c, conduitPin], ["resonance", r, resonancePin]]) {
    checks.push({ check: `contract:${name}`, live: body?.contractRevision ?? null, pinned: pin ?? null, ok: revOk[name] });
    if (!revOk[name]) problems.push(`contract_mismatch:${name}:${body?.contractRevision ?? "unavailable"}`);
  }
  const gateOk = Boolean(r) && r.ownerActionRequired === false && Array.isArray(r.ownerKeys) && r.ownerKeys.length === 0
    && Array.isArray(r.missingRequired) && r.missingRequired.length === 0;
  checks.push({ check: "owner_gate:resonance", ok: gateOk, live: r ? { ownerActionRequired: r.ownerActionRequired, ownerKeys: r.ownerKeys, missingRequired: r.missingRequired } : null });
  if (!gateOk) problems.push("owner_gate_open_or_unknown:resonance");

  const phases = parsePhases(roadmap);
  if (roadmap == null) problems.push("roadmap_unavailable");
  else if (phases.length === 0) problems.push("roadmap_unparseable");
  const counts = Object.values(live?.openPrs ?? {});
  const evidence = {
    1: c?.status === "ready" && c?.production === true && r?.status === "ready" && r?.production === true && revOk.conduit && revOk.resonance,
    2: live?.unauthPostStatus === 401,
    3: counts.length > 0 && counts.every((n) => Number.isInteger(n) && n < PR_TARGET), // one snapshot: necessary, not sufficient (7 days)
  };
  for (const p of phases) {
    if (p.status === "unparseable") { problems.push("phase_row_unparseable"); continue; }
    if (p.status === "unknown") { problems.push(`phase_status_unknown:${p.n}`); continue; }
    // 1.0 needs every prerequisite phase 1..9 present and passed; a missing row is not a pass.
    const ev = p.n === 10 ? [1, 2, 3, 4, 5, 6, 7, 8, 9].every((n) => phases.some((q) => q.n === n && q.status === "passed")) : evidence[p.n];
    const row = { phase: p.n, name: p.name, claimed: p.status, evidence: ev === undefined ? "unchecked" : ev ? "pass" : "fail" };
    checks.push(row);
    if (ev === undefined) continue;
    if (p.status === "passed" && !ev) problems.push(`phase_claim_contradicted:${p.n}`);
    if (p.status !== "passed" && ev && p.n !== 3) stale.push(`phase_${p.n}_evidence_passes_but_doc_says_${p.status.replace(" ", "_")}`);
  }
  return { consistent: problems.length === 0, problems, stale, checks };
}

export function consistencyMarkdown(k) {
  return [`**Consistency: ${k.consistent ? "CONSISTENT" : "INCONSISTENT"}**${k.problems.length ? ` (${k.problems.join(", ")})` : ""}`,
    ...(k.stale.length ? [`Stale doc statuses: ${k.stale.join(", ")}`] : []), "",
    "| Check | Claimed / live | Evidence |", "|---|---|---|",
    ...k.checks.map((x) => x.phase !== undefined
      ? `| phase ${x.phase} ${x.name} | ${x.claimed} | ${x.evidence} |`
      : `| ${x.check} | ${JSON.stringify(x.live)}${x.pinned ? ` (pin ${x.pinned})` : ""} | ${x.ok ? "pass" : "FAIL"} |`)].join("\n");
}
