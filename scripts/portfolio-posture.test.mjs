import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyConduitReady, classifyResonanceReady, classifyDevice, classifyAlias, crossPlaneConsistency, isColdStart } from './portfolio-posture.mjs';

test('cold_start covers timeouts and gateway errors on both planes', () => {
  for (const s of [0, 502, 504, undefined, null, NaN]) {
    assert.equal(isColdStart(s), true, String(s));
    assert.equal(classifyConduitReady(undefined, s).posture, 'cold_start');
    assert.equal(classifyResonanceReady(undefined, s).posture, 'cold_start');
  }
  assert.equal(classifyConduitReady(undefined, 502).reason, 'gateway_502');
  assert.equal(classifyConduitReady(undefined, 0).reason, 'timeout_or_zero');
});

test('cold_start is never ready, owner_gate, or deploy_lag', () => {
  for (const s of [200, 503, 404, 500]) assert.equal(isColdStart(s), false);
  assert.equal(classifyConduitReady({ status: 'ready' }, 500).posture, 'unknown');
});

test('conduit ready requires postgres + contract stamp', () => {
  assert.equal(classifyConduitReady({ status: 'ready', persistence: 'postgres', contractRevision: 'x' }, 200).posture, 'ready');
  assert.equal(classifyConduitReady({ status: 'ready', persistence: 'memory' }, 200).posture, 'incomplete_ready');
  assert.equal(classifyConduitReady({}, 503).posture, 'deploy_lag');
});

test('resonance 200 fails closed without ready body', () => {
  assert.equal(classifyResonanceReady(undefined, 200).posture, 'incomplete_ready');
  assert.equal(classifyResonanceReady({ status: 'ready' }, 200).posture, 'ready');
  assert.equal(classifyResonanceReady({ missingRequired: ['SUPABASE_SERVICE_ROLE_KEY'] }, 503).posture, 'owner_gate');
  assert.equal(classifyResonanceReady({ status: 'not_ready', stage: 'deployment' }, 503).posture, 'deploy_lag');
});

test('device stays not_recorded while CHR-55 open; alias rules strict', () => {
  assert.equal(classifyDevice({ deviceAcceptance: 'not_recorded', acceptanceGate: 'CHR-55' }).posture, 'device_not_recorded');
  assert.equal(classifyDevice({}).posture, 'unknown');
  assert.equal(classifyAlias(404).posture, 'alias_absent');
  assert.equal(classifyAlias(200, {}).posture, 'stranger');
});

test('cross-plane consistency is fail-closed', () => {
  const ready = { posture: 'ready' };
  assert.equal(crossPlaneConsistency(ready, ready).verdict, 'consistent_ready');
  assert.equal(crossPlaneConsistency({ posture: 'cold_start' }, ready).verdict, 'retry');
  assert.equal(crossPlaneConsistency(ready, { posture: 'owner_gate' }).verdict, 'blocked');
  assert.equal(crossPlaneConsistency(ready, { posture: 'unknown' }).verdict, 'inconsistent');
  assert.equal(crossPlaneConsistency(undefined, ready).verdict, 'inconsistent');
  assert.equal(crossPlaneConsistency({ posture: 'incomplete_ready' }, ready).verdict, 'not_ready');
});
