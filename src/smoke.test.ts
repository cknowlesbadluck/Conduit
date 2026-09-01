import test from 'node:test';
import assert from 'node:assert/strict';
import { createTask, claimTask, completeTask, handoff } from './store.js';

test('task lifecycle enforces completion ownership', async () => {
  const t = await createTask({ title: 'smoke', createdBy: 'agent-a' });
  const claimed = await claimTask(t.id, 'agent-b');
  assert.ok(claimed);
  assert.equal(await completeTask(t.id, 'agent-c'), null);
  const done = await completeTask(t.id, 'agent-b');
  assert.ok(done);
  assert.equal(done.status, 'completed');
});

test('task handoff requires the current claimant', async () => {
  const t = await createTask({ title: 'handoff', createdBy: 'agent-a' });
  const claimed = await claimTask(t.id, 'agent-b');
  assert.ok(claimed);
  assert.equal(await handoff(t.id, 'agent-c', 'agent-d', 'unauthorized'), null);
  const moved = await handoff(t.id, 'agent-b', 'agent-d', 'valid');
  assert.ok(moved);
  assert.equal(moved.claimedBy, 'agent-d');
});
