import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAgent, createTask, claimTask, completeTask, handoff } from './store.js';

test('task lifecycle enforces registered-agent ownership', async () => {
  await registerAgent({ id: 'agent-a', name: 'Agent A' });
  await registerAgent({ id: 'agent-b', name: 'Agent B' });
  assert.equal(await createTask({ title: 'invalid', createdBy: 'unknown' }), null);
  const t = await createTask({ title: 'smoke', createdBy: 'agent-a' });
  assert.ok(t);
  assert.equal(await claimTask(t.id, 'unknown'), null);
  const claimed = await claimTask(t.id, 'agent-b');
  assert.ok(claimed);
  assert.equal(await completeTask(t.id, 'agent-a'), null);
  const done = await completeTask(t.id, 'agent-b');
  assert.ok(done);
  assert.equal(done.status, 'completed');
});

test('task handoff requires the current claimant and registered target', async () => {
  await registerAgent({ id: 'agent-c', name: 'Agent C' });
  await registerAgent({ id: 'agent-d', name: 'Agent D' });
  const t = await createTask({ title: 'handoff', createdBy: 'agent-c' });
  assert.ok(t);
  const claimed = await claimTask(t.id, 'agent-c');
  assert.ok(claimed);
  assert.equal(await handoff(t.id, 'agent-d', 'agent-c', 'unauthorized'), null);
  assert.equal(await handoff(t.id, 'agent-c', 'unknown', 'unregistered target'), null);
  const moved = await handoff(t.id, 'agent-c', 'agent-d', 'valid');
  assert.ok(moved);
  assert.equal(moved.claimedBy, 'agent-d');
});
