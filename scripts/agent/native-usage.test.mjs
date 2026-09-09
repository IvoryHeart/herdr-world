import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { summarizeNativeUsage } from './native-usage.mjs';

const at = second => '2026-01-01T00:00:' + String(second).padStart(2, '0') + '.000Z';
const row = (type, payload, second = 0) => ({ type, payload, timestamp: at(second) });
const start = (turn, second) => row('event_msg', { type: 'task_started', turn_id: turn }, second);
const done = (turn, second) => row('event_msg', { type: 'task_complete', turn_id: turn }, second);
const model = (name, second) => row('turn_context', { model: name, effort: 'high' }, second);
const usage = (thread, id, second, count = 100, turn = 'turn') => row('token_usage_record', {
  thread_id: thread, turn_id: turn, response_id: id, usage: { input_tokens: count, cached_input_tokens: count - 20, output_tokens: 10, reasoning_output_tokens: 4 },
}, second);
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'native-usage-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function journal(dir, name, id, parent, rows) {
  const source = parent ? { subagent: { thread_spawn: { parent_thread_id: parent, agent_path: '/root/' + id } } } : 'cli';
  const meta = row('session_meta', { id, source, cwd: '/synthetic/worktree' });
  await writeFile(join(dir, name + '.jsonl'), [meta, ...rows].map(JSON.stringify).join('\n') + '\n');
}

test('native accounting follows ancestry, deduplicates forks/rotation, separates models and ignores cumulative token events', async t => {
  const dir = await fixture(t);
  const first = usage('lead', 'one', 2, 100, 't1');
  await journal(dir, 'a', 'lead', null, [start('t1', 1), model('sol', 1), first, done('t1', 3),
    start('t2', 10), model('astra', 10), usage('lead', 'two', 11, 200, 't2'), done('t2', 12),
    row('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 9999999 } } }, 12)]);
  await journal(dir, 'a-copy', 'lead', null, [start('t1', 1), model('sol', 1), first, done('t1', 3)]);
  await journal(dir, 'b', 'review', 'lead', [first, start('t3', 3), model('sol', 3), usage('review', 'three', 4, 100, 't3'), done('t3', 5)]);
  await journal(dir, 'c', 'nested', 'review', [start('t4', 5), model('sol', 5), usage('nested', 'four', 6, 100, 't4'), done('t4', 7)]);
  await journal(dir, 'unrelated', 'outside', null, [start('other', 1), model('astra', 1), usage('outside', 'ignored', 2, 900), done('other', 3)]);
  const result = await summarizeNativeUsage({ sessions: dir, thread: 'lead', until: at(20) });
  assert.equal(result.responses, 4);
  assert.equal(result.usage.input_tokens, 500);
  assert.equal(result.usage.cached_input_tokens, 420);
  assert.equal(result.usage.output_tokens, 40);
  assert.equal(result.byModel['astra/high'].usage.input_tokens, 200);
  assert.equal(result.byModel['sol/high'].usage.input_tokens, 300);
  assert.equal(result.agents.length, 3);
  assert.equal(result.agents.find(a => a.thread === 'lead').activeSeconds, 4);
  assert.equal(result.agents.find(a => a.thread === 'lead').elapsedSeconds, 11);
  assert.equal(result.coverage, 'recorded-completed-responses');
  assert.equal(result.costUsd, null);
  const scoped = await summarizeNativeUsage({ sessions: dir, thread: 'lead', since: at(10), until: at(20) });
  assert.equal(scoped.responses, 1);
  assert.equal(scoped.agents.length, 1);
  assert.equal(scoped.coverage, 'recorded-completed-responses');
});

test('running turns and known missing children produce provisional reports instead of false zero-cost success', async t => {
  const dir = await fixture(t);
  await journal(dir, 'lead', 'lead', null, [start('turn', 1), model('sol', 1), usage('lead', 'one', 2),
    row('response_item', { type: 'function_call', name: 'spawn_agent', call_id: 'spawn' }, 3),
    row('response_item', { type: 'function_call_output', call_id: 'spawn', output: JSON.stringify({ agent_id: 'missing' }) }, 4)]);
  const result = await summarizeNativeUsage({ sessions: dir, thread: 'lead', until: at(6) });
  assert.equal(result.coverage, 'provisional');
  assert.equal(result.agents[0].status, 'running-at-cutoff');
  assert.equal(result.agents[0].activeSeconds, 5);
  assert.match(result.warnings.join('\n'), /child history is missing/);
  assert.equal(result.usage.input_tokens, 100);
});

test('native child lifecycle events reveal missing histories after lead completion', async t => {
  const dir = await fixture(t);
  await journal(dir, 'lead', 'lead', null, [start('turn', 1), model('sol', 1), usage('lead', 'one', 2),
    row('response_item', { type: 'function_call', name: 'spawn_agent', call_id: 'spawn-call' }, 3),
    row('event_msg', { type: 'item_completed', thread_id: 'lead', turn_id: 'turn', item: {
      type: 'SubAgentActivity', id: 'spawn-call', kind: 'started',
      agent_thread_id: 'missing-child', agent_path: '/root/missing-child',
    } }, 3),
    row('response_item', { type: 'function_call_output', call_id: 'spawn-call', output: JSON.stringify({ task_name: '/root/missing-child' }) }, 4),
    done('turn', 5)]);
  const result = await summarizeNativeUsage({ sessions: dir, thread: 'lead', until: at(6) });
  assert.equal(result.agents[0].status, 'completed');
  assert.equal(result.coverage, 'provisional');
  assert.deepEqual(result.warnings, ['Spawned child history is missing: missing-child']);
  assert.equal(result.usage.input_tokens, 100);
});

test('an unmeasured completed turn remains visible beside measured turns in the same thread', async t => {
  const dir = await fixture(t);
  await journal(dir, 'lead', 'lead', null, [start('turn', 1), model('sol', 1), usage('lead', 'one', 2), done('turn', 3),
    start('unmeasured-turn', 4), done('unmeasured-turn', 5)]);
  const result = await summarizeNativeUsage({ sessions: dir, thread: 'lead', until: at(6) });
  assert.equal(result.agents[0].status, 'completed');
  assert.equal(result.coverage, 'provisional');
  assert.match(result.warnings.join('\n'), /No measured responses for selected turn unmeasured-turn/);
  assert.equal(result.usage.input_tokens, 100);
  const earlier = await summarizeNativeUsage({ sessions: dir, thread: 'lead', until: at(3) });
  assert.equal(earlier.coverage, 'recorded-completed-responses');
});

test('time scoping retains missing children that complete or remain active after the lower boundary', async t => {
  const dir = await fixture(t);
  const childEvent = (child, kind, second) => row('event_msg', { type: 'item_completed', item: {
    type: 'SubAgentActivity', kind, agent_thread_id: child,
  } }, second);
  await journal(dir, 'lead', 'lead', null, [start('turn', 1), model('sol', 1),
    childEvent('finished-earlier', 'started', 1), childEvent('finished-earlier', 'completed', 2),
    childEvent('finishes-inside', 'started', 2), childEvent('still-active', 'started', 2),
    usage('lead', 'one', 4), childEvent('finishes-inside', 'completed', 5), done('turn', 6)]);
  const result = await summarizeNativeUsage({ sessions: dir, thread: 'lead', since: at(3), until: at(7) });
  assert.equal(result.coverage, 'provisional');
  assert.deepEqual(result.warnings.sort(), [
    'Spawned child history is missing: finishes-inside',
    'Spawned child history is missing: still-active',
  ]);
});

test('corrupt/conflicting records and unmeasured histories remain visible; invalid scope is rejected', async t => {
  const dir = await fixture(t);
  await journal(dir, 'lead', 'lead', null, [start('turn', 1), model('sol', 1), usage('lead', 'same', 2), usage('lead', 'same', 3, 300), done('turn', 4)]);
  await journal(dir, 'empty', 'empty', 'lead', []);
  await writeFile(join(dir, 'broken.jsonl'), '{incomplete');
  const result = await summarizeNativeUsage({ sessions: dir, thread: 'lead', until: at(8) });
  assert.equal(result.usage.input_tokens, 100);
  assert.equal(result.coverage, 'provisional');
  assert.match(result.warnings.join('\n'), /Conflicting duplicate/);
  assert.match(result.warnings.join('\n'), /No measured responses/);
  assert.match(result.warnings.join('\n'), /Unreadable session header/);
  await assert.rejects(summarizeNativeUsage({ sessions: dir, thread: 'absent' }), /not found/);
  await assert.rejects(summarizeNativeUsage({ sessions: dir, thread: 'lead', since: at(8), until: at(2) }), /ordered ISO/);
});

test('allocation comparison catches worker overrides without invalidating complete token accounting', async t => {
  const dir = await fixture(t);
  await journal(dir, 'lead', 'lead', null, [start('turn', 1), model('sol', 1), usage('lead', 'one', 2), done('turn', 3)]);
  await journal(dir, 'worker', 'worker', 'lead', [start('turn', 3), model('terra', 3), usage('worker', 'two', 4), done('turn', 5)]);
  const result = await summarizeNativeUsage({ sessions: dir, thread: 'lead', until: at(6), expectModel: 'sol', expectEffort: 'high' });
  assert.equal(result.allocation?.status, 'mismatch');
  assert.deepEqual(result.allocation.mismatches, [{ thread: 'worker', role: '/root/worker', model: 'terra', effort: 'high', responses: 1 }]);
  assert.equal(result.coverage, 'recorded-completed-responses');
  assert.equal(result.usage.input_tokens, 200);
  assert.equal(result.agents[0].startupCwd, '/synthetic/worktree');
  const effortOnly = await summarizeNativeUsage({ sessions: dir, thread: 'lead', until: at(6), expectEffort: 'high' });
  assert.equal(effortOnly.allocation.status, 'matched');
  const wrongEffort = await summarizeNativeUsage({ sessions: dir, thread: 'lead', until: at(6), expectEffort: 'low' });
  assert.equal(wrongEffort.allocation.status, 'mismatch');
});

test('allocation matching respects the measured time window and cannot certify incomplete evidence', async t => {
  const dir = await fixture(t);
  await journal(dir, 'lead', 'lead', null, [start('old', 1), model('terra', 1), usage('lead', 'old', 2, 100, 'old'), done('old', 3),
    start('turn', 4), model('sol', 4), usage('lead', 'new', 5), done('turn', 6)]);
  const options = { sessions: dir, thread: 'lead', since: at(4), until: at(7), expectModel: 'sol', expectEffort: 'high' };
  assert.equal((await summarizeNativeUsage(options)).allocation?.status, 'matched');
  assert.equal((await summarizeNativeUsage({ ...options, until: at(5) })).allocation.status, 'unverified');
  await journal(dir, 'child', 'child', 'lead', [start('turn', 4), usage('child', 'unknown-model', 5), done('turn', 6)]);
  assert.equal((await summarizeNativeUsage(options)).allocation.status, 'unverified');
  assert.equal((await summarizeNativeUsage({ sessions: dir, thread: 'lead', until: at(7) })).allocation.status, 'not-requested');
  await assert.rejects(summarizeNativeUsage({ ...options, expectModel: ' ' }), /nonempty/);
});
