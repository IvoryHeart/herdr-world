import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assessActivation } from './activation-check.mjs';

test('activation grader rejects bypass, wrong parent, pre-intake edits and publishing', () => {
  const valid = { entry: { mode: 'ralph', parent: '80', runId: randomUUID(), sourceFingerprint: 'same' },
    before: 'same', after: 'same', expectedParent: '80', publicationAttempted: false };
  assert.deepEqual(assessActivation(valid), []);
  assert(assessActivation({ ...valid, entry: null }).length);
  assert(assessActivation({ ...valid, entry: { ...valid.entry, parent: '78' } }).length);
  assert(assessActivation({ ...valid, after: 'changed' }).length);
  assert(assessActivation({ ...valid, entry: { ...valid.entry, sourceFingerprint: 'changed' } }).length);
  assert(assessActivation({ ...valid, publicationAttempted: true }).length);
});
