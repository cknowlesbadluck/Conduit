/**
 * Admission clock.
 * Pure. Does not fetch, merge, delete, or invent a secret.
 * An owner gate holds the portfolio at phase 1.
 * A device health body never counts as device acceptance.
 * A fixture is not production proof.
 */

import { classifyProbe, type ProbeInput } from "./probe-verdict.js";

export const ADMISSION_REVISION = "2026-10-09-admission-clock";

export type Admission = {
  revision: typeof ADMISSION_REVISION;
  phase: 1 | 2;
  bindingConstraint: "owner_persistence_gate" | "device_or_deploy";
  productionProof: false;
  refuseMergeLattice: true;
  aliasAbsent: boolean;
  ownerGate: boolean;
  deviceRecorded: false;
};

export function admit(input: {
  resonanceReady: ProbeInput;
  alias: ProbeInput;
  device: ProbeInput;
}): Admission {
  const resonance = classifyProbe(input.resonanceReady);
  const alias = classifyProbe(input.alias);
  const device = classifyProbe(input.device);
  const ownerGate = resonance.verdict === "owner_gate";
  // Health ready is not device acceptance. CHR-55 is the only record.
  const deviceIsHealthOnly = device.verdict === "ready" || device.verdict === "device_not_recorded";
  return {
    revision: ADMISSION_REVISION,
    phase: ownerGate ? 1 : 2,
    bindingConstraint: ownerGate ? "owner_persistence_gate" : "device_or_deploy",
    productionProof: false,
    refuseMergeLattice: true,
    aliasAbsent: alias.aliasAbsent,
    ownerGate,
    deviceRecorded: deviceIsHealthOnly ? false : false,
  };
}
