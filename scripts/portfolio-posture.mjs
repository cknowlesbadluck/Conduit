#!/usr/bin/env node
/**
 * PortfolioPosture classifier — pure, no secrets, fail-closed.
 * Classifies live probe responses into owner_gate | deploy_lag | alias_absent | device_not_recorded | cold_start | ready | incomplete_ready | unknown.
 * Unit-testable. Used for cross-repo posture evidence.
 */

// Statuses that mean "host not answering yet" (free-tier spin-up, gateway timeout),
// never evidence of readiness or of an owner gate.
const COLD_START_STATUSES = new Set([0, 502, 504]);

export function isColdStart(status) {
  return status === undefined || status === null || Number.isNaN(status) || COLD_START_STATUSES.has(status);
}

function coldStart(status) {
  return { posture: 'cold_start', reason: status === 0 || status == null || Number.isNaN(status) ? 'timeout_or_zero' : `gateway_${status}` };
}

export function classifyResonanceReady(body, status) {
  if (isColdStart(status)) return coldStart(status);
  if (status !== 503 && status !== 200) return { posture: 'unknown', reason: `unexpected_status_${status}` };
  if (status === 200) {
    // Fail closed: a 200 without an explicit ready body is not proof of readiness.
    if (!body || typeof body !== 'object' || body.status !== 'ready') return { posture: 'incomplete_ready', reason: 'missing_ready_body' };
    return { posture: 'ready', reason: 'ok' };
  }
  if (!body || typeof body !== 'object') return { posture: 'unknown', reason: 'no_body' };
  const missing = body.missingRequired || [];
  if (missing.includes('SUPABASE_SERVICE_ROLE_KEY')) {
    return { posture: 'owner_gate', reason: 'missing_SUPABASE_SERVICE_ROLE_KEY', ownerActionRequired: true };
  }
  if (body.status === 'not_ready' && body.stage === 'deployment') {
    return { posture: 'deploy_lag', reason: body.stage };
  }
  return { posture: 'unknown', reason: 'unclassified_503' };
}

export function classifyConduitReady(body, status) {
  if (isColdStart(status)) return coldStart(status);
  if (status === 200 && body?.status === 'ready') {
    if (body.persistence === 'postgres' && body.contractRevision) {
      return { posture: 'ready', reason: 'stamped', contractRevision: body.contractRevision };
    }
    return { posture: 'incomplete_ready', reason: 'missing_stamp_or_persistence', contractRevision: body.contractRevision || null, persistence: body.persistence || null };
  }
  if (status === 503) return { posture: 'deploy_lag', reason: 'not_ready' };
  return { posture: 'unknown', reason: `status_${status}` };
}

export function classifyDevice(healthBody) {
  if (healthBody?.deviceAcceptance === 'not_recorded' || healthBody?.acceptanceGate === 'CHR-55') {
    return { posture: 'device_not_recorded', reason: 'CHR-55_pending' };
  }
  if (healthBody?.deviceAcceptance === 'recorded') return { posture: 'device_recorded', reason: 'ok' };
  return { posture: 'unknown', reason: 'no_device_field' };
}

// Alias / stranger: 404 or unexpected 200 never owner_gate or ready
export function classifyAlias(status, body) {
  if (status === 404) return { posture: 'alias_absent', reason: '404' };
  if (status === 200 && (!body || body.status !== 'ready')) return { posture: 'stranger', reason: 'unexpected_200' };
  return null;
}

/**
 * Read-only cross-plane consistency check between Conduit and Resonance postures.
 * Pure: takes already-classified postures, performs no I/O. Fail-closed: the portfolio is
 * only "consistent_ready" when both planes are fully ready; cold starts are retryable, never proof.
 */
export function crossPlaneConsistency(conduit, resonance) {
  const c = conduit?.posture ?? 'unknown';
  const r = resonance?.posture ?? 'unknown';
  if (c === 'cold_start' || r === 'cold_start') return { verdict: 'retry', reason: 'cold_start', conduit: c, resonance: r };
  if (c === 'ready' && r === 'ready') return { verdict: 'consistent_ready', reason: 'both_ready', conduit: c, resonance: r };
  if (r === 'owner_gate') return { verdict: 'blocked', reason: 'resonance_owner_gate', ownerActionRequired: true, conduit: c, resonance: r };
  if (c === 'unknown' || r === 'unknown') return { verdict: 'inconsistent', reason: 'unclassified_plane', conduit: c, resonance: r };
  return { verdict: 'not_ready', reason: `${c}/${r}`, conduit: c, resonance: r };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // CLI smoke / self-test
  const sampleResonance = { status: 'not_ready', missingRequired: ['SUPABASE_SERVICE_ROLE_KEY'] };
  console.log('Resonance owner_gate:', JSON.stringify(classifyResonanceReady(sampleResonance, 503)));
  const incomplete = { status: 'ready', persistence: 'memory' };
  console.log('Conduit incomplete_ready:', JSON.stringify(classifyConduitReady(incomplete, 200)));
  const stamped = { status: 'ready', persistence: 'postgres', contractRevision: '2026-10-03-ready-surface' };
  console.log('Conduit ready:', JSON.stringify(classifyConduitReady(stamped, 200)));
}
