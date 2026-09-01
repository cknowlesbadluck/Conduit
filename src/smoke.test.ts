import test from 'node:test';
import assert from 'node:assert/strict';
import { createTask, claimTask, completeTask } from './store.js';

test('task lifecycle enforces ownership', async () => {
  const t = await createTask({title:'smoke', created_by:'agent-a'});
  await claimTask(t.id,'agent-b');
  await assert.rejects(() => claimTask(t.id,'agent-c'));
  const done = await completeTask(t.id,'agent-b');
  assert.equal(done.status,'completed');
});
