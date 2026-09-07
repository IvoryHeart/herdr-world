import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveModels, responseSchema, parseResponse, acceptResponse, evidenceCurrent, failureEvent, initialEvent } from './workflow.mjs';

const acceptance = [{ id: 'retry', criterion: 'Retry delay is bounded at 5000 ms.' }];
const scenarios = [{ id: 'cap', acceptanceIds: ['retry'], steps: 'Call retry with attempt 30.', expected: 'delayMs is 5000.' }];
function plan(state = { task: 'Fix retry cap.', taskProfile: 'routine', consecutiveFailures: 0 }) {
  acceptResponse(state, 'planner', { event: 'plan.ready', summary: 'Repair the cap.', acceptance, specialists: [] }, 'base', 'base');
  acceptResponse(state, 'qa-planner', { event: 'qa.planned', summary: 'Check the upper bound.', scenarios }, 'base', 'base');
  return state;
}
function reviewed(state) {
  acceptResponse(state, 'implementer', { event: 'candidate.ready', summary: 'Repaired.' }, 'base', 'fixed');
  acceptResponse(state, 'reviewer', { event: 'review.passed', summary: 'Inspected cap.' }, 'fixed', 'fixed');
}
test('two-history defaults use Sol high, bounded full workers use Luna xhigh, overrides stay explicit', async () => {
  const config = JSON.parse(await readFile(new URL('../../harness/models.json', import.meta.url)));
  const models = resolveModels(config);
  assert.deepEqual(models.implementer, { model: 'gpt-5.6-sol', reasoningEffort: 'high' });
  assert.deepEqual(resolveModels(config, { workflow: 'full' }).implementer, { model: 'gpt-5.6-luna', reasoningEffort: 'xhigh' });
  assert.equal(models.oracle.reasoningEffort, 'xhigh');
  assert.equal(models.qa.model, models.implementer.model);
  assert.equal(models.oracle.model, 'gpt-5.6-sol');
  assert(Object.values(resolveModels(config, { model: 'comparison', reasoningEffort: 'high' })).every(m => m.model === 'comparison' && m.reasoningEffort === 'high'));
  assert.throws(() => resolveModels(config, { reasoningEffort: 'unsupported' }), /Invalid/);
});
test('feature shaping is conditional and cannot invent a new acceptance contract during delivery', () => {
  assert.equal(initialEvent('feature'), 'product.start');
  assert.equal(initialEvent('routine'), 'plan.start');
  const state = { task: 'Fix retry cap.', taskProfile: 'feature' };
  acceptResponse(state, 'product', { event: 'requirements.ready', summary: 'Bounded retries.', acceptance }, 'base', 'base');
  plan(state);
  acceptResponse(state, 'planner', { event: 'plan.ready', summary: 'Same criteria, different object field order.',
    acceptance: [{ criterion: acceptance[0].criterion, id: acceptance[0].id }], specialists: [] }, 'base', 'base');
  assert.throws(() => acceptResponse(state, 'planner', { event: 'plan.ready', summary: 'Weaken the cap.', acceptance: [{ id: 'retry', criterion: 'Any delay is acceptable.' }], specialists: [] }, 'base', 'base'), /Acceptance changed/);
});
test('QA planning rejects omitted criteria and undeclared acceptance references', () => {
  const state = plan();
  for (const invalid of [[], [{ ...scenarios[0], acceptanceIds: ['imagined'] }], [{ ...scenarios[0], steps: '' }]]) {
    assert.throws(() => acceptResponse(state, 'qa-planner', { event: 'qa.planned', summary: 'Insufficient.', scenarios: invalid }, 'base', 'base'), /cover every/);
  }
});
test('QA pass requires evidence for every scenario and matching candidate and acceptance versions', () => {
  const state = plan(); reviewed(state);
  const result = { event: 'qa.passed', summary: 'Executed cap check.', results: [{ scenarioId: 'cap', status: 'passed', evidence: 'Node assertion: attempt 30 returned 5000.' }] };
  assert.equal(evidenceCurrent(state, 'fixed'), false);
  assert.throws(() => acceptResponse(state, 'qa', { ...result, results: [] }, 'fixed', 'fixed'), /every planned/);
  assert.throws(() => acceptResponse(state, 'qa', { ...result, results: [{ ...result.results[0], status: 'failed' }] }, 'fixed', 'fixed'), /cannot pass/);
  acceptResponse(state, 'qa', result, 'fixed', 'fixed');
  assert.equal(evidenceCurrent(state, 'fixed'), true);
  assert.equal(evidenceCurrent(state, 'later'), false);
  const changedCriteria = structuredClone(state); changedCriteria.requirements.hash = 'changed';
  assert.equal(evidenceCurrent(changedCriteria, 'fixed'), false);
  acceptResponse(state, 'implementer', { event: 'candidate.ready', summary: 'Another patch.' }, 'fixed', 'later');
  assert.equal(state.qa, null); assert.equal(state.review, null);
});
test('read-only product, QA and Oracle cannot mutate the candidate', () => {
  for (const role of ['product', 'planner', 'qa-planner', 'reviewer', 'qa', 'oracle']) {
    assert.throws(() => acceptResponse(plan(), role, { event: 'task.blocked', summary: 'changed' }, 'before', 'after'), /Read-only/);
  }
});
test('Oracle returns to its caller, is bounded across persisted state and never resets failure budgets', () => {
  let state = plan();
  assert.equal(acceptResponse(state, 'planner', { event: 'oracle.requested', summary: 'Investigate retry ownership.' }, 'base', 'base').event, 'oracle.requested');
  state = JSON.parse(JSON.stringify(state));
  assert.equal(acceptResponse(state, 'oracle', { event: 'oracle.advised', summary: 'Evidence at helper:10; test cap.' }, 'base', 'base').event, 'plan.start');
  assert.equal(failureEvent(state, 'qa.failed', 'First defect.').event, 'qa.failed');
  assert.equal(failureEvent(state, 'qa.failed', 'Second defect.').event, 'oracle.requested');
  assert.equal(state.consecutiveFailures, 2);
  assert.equal(acceptResponse(state, 'oracle', { event: 'oracle.advised', summary: 'Repair the cap.' }, 'base', 'base').event, 'implementation.start');
  assert.equal(acceptResponse(state, 'implementer', { event: 'oracle.requested', summary: 'Ask again.' }, 'base', 'base').event, 'task.blocked');
});
test('sensitive tasks deterministically activate security and protocol lenses', () => {
  assert.deepEqual(plan({ task: 'Fix retry cap.', taskProfile: 'sensitive' }).specialists, ['security', 'protocol']);
});
test('model schemas and parser restrict roles without accepting completion or cross-role claims', () => {
  assert(responseSchema('qa').required.includes('results'));
  assert.throws(() => parseResponse(JSON.stringify({ event: 'qa.passed', summary: 'pass' }), 'qa'), /Missing/);
  assert.throws(() => parseResponse(JSON.stringify({ event: 'LOOP_COMPLETE', summary: 'pass' }), 'implementer'), /Invalid/);
  assert.throws(() => parseResponse(JSON.stringify({ event: 'candidate.ready', summary: 'pass', approval: true }), 'implementer'), /Invalid/);
});

test('intake cannot mix unanswered questions with an acceptance contract or mutate source', () => {
  const state = {};
  const ask = { event: 'intake.questions', summary: 'Need a cap.', acceptance: [], questions: [{ id: 'cap', question: 'What cap?' }] };
  assert.equal(acceptResponse(state, 'intake', ask, 'same', 'same').event, 'intake.questions');
  assert.equal(state.requirements, undefined);
  assert.throws(() => acceptResponse(state, 'intake', { ...ask, acceptance: [{ id: 'a', criterion: 'Assumed cap' }] }, 'same', 'same'), /never both/);
  assert.throws(() => acceptResponse(state, 'intake', ask, 'before', 'after'), /Read-only/);
  assert.throws(() => acceptResponse(state, 'intake', { ...ask, event: 'intake.ready', questions: [] }, 'same', 'same'), /Acceptance/);
});
