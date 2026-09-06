import { createHash } from 'node:crypto';

export const roleEvents = {
  product: ['requirements.ready', 'task.blocked'],
  planner: ['plan.ready', 'oracle.requested', 'task.blocked'],
  'qa-planner': ['qa.planned', 'oracle.requested', 'task.blocked'],
  implementer: ['candidate.ready', 'oracle.requested', 'task.blocked'],
  reviewer: ['review.passed', 'review.rejected', 'oracle.requested', 'task.blocked'],
  qa: ['qa.passed', 'qa.failed', 'oracle.requested', 'task.blocked'],
  oracle: ['oracle.advised', 'task.blocked'],
};
export const taskProfiles = ['routine', 'feature', 'sensitive'];
export const specialistNames = ['security', 'protocol', 'ux-accessibility', 'performance'];
export const readOnlyRoles = new Set(Object.keys(roleEvents).filter(role => role !== 'implementer'));
export const initialEvent = profile => profile === 'feature' ? 'product.start' : 'plan.start';
const returnEvents = { planner: 'plan.start', 'qa-planner': 'qa.plan', implementer: 'implementation.start', reviewer: 'candidate.ready', qa: 'qa.start' };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = { type: 'string' };
const array = items => ({ type: 'array', items });
const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const criterion = object({ id: text, criterion: text });
const scenario = object({ id: text, acceptanceIds: array(text), steps: text, expected: text });
const result = object({ scenarioId: text, status: { type: 'string', enum: ['passed', 'failed', 'blocked'] }, evidence: text });

export function responseSchema(role) {
  if (!roleEvents[role]) throw new Error('Unknown model role: ' + role);
  const properties = { event: { type: 'string', enum: roleEvents[role] }, summary: text };
  if (['product', 'planner'].includes(role)) properties.acceptance = array(criterion);
  if (role === 'planner') properties.specialists = array({ type: 'string', enum: specialistNames });
  if (role === 'qa-planner') properties.scenarios = array(scenario);
  if (role === 'qa') properties.results = array(result);
  return object(properties);
}
export function parseResponse(output, role) {
  const response = JSON.parse(output);
  const schema = responseSchema(role);
  if (!roleEvents[role].includes(response.event) || typeof response.summary !== 'string' || !response.summary.trim()
    || Object.keys(response).some(key => !schema.required.includes(key))) throw new Error('Invalid response for ' + role);
  for (const key of schema.required.filter(key => !['event', 'summary'].includes(key))) {
    if (!Array.isArray(response[key])) throw new Error('Missing structured ' + key + ' for ' + role);
  }
  return response;
}
function nonempty(value) { return typeof value === 'string' && value.trim().length > 0; }
function unique(items, key) { return new Set(items.map(item => item[key])).size === items.length; }
export function resolveModels(config, { model, workerModel, leadModel, reasoningEffort } = {}) {
  const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];
  return Object.fromEntries(Object.entries(config.roles).map(([role, tier]) => {
    const selected = { ...config[tier], model: model ?? (tier === 'worker' ? workerModel : leadModel) ?? config[tier]?.model };
    selected.reasoningEffort = reasoningEffort ?? selected.reasoningEffort;
    if (!nonempty(selected.model) || !efforts.includes(selected.reasoningEffort)) throw new Error('Invalid model policy for ' + role);
    return [role, selected];
  }));
}
export function invalidateCandidate(state) {
  state.review = null; state.qa = null; state.verification = null;
}
export function evidenceCurrent(state, current) {
  const requirements = state.requirements?.hash;
  return Boolean(requirements && state.qaPlan?.requirementsHash === requirements
    && state.review?.event === 'review.passed' && state.review.fingerprint === current
    && state.review.requirementsHash === requirements
    && state.qa?.event === 'qa.passed' && state.qa.fingerprint === current
    && state.qa.requirementsHash === requirements && state.qa.planHash === state.qaPlan.hash);
}
export function requestOracle(state, role, question) {
  state.oracle ??= { consultations: 0 };
  if (!returnEvents[role] || state.oracle.consultations >= 2) {
    return { event: 'task.blocked', summary: 'Oracle consultation limit reached. ' + question };
  }
  state.oracle.consultations += 1;
  state.oracle.pending = { role, question, returnEvent: returnEvents[role] };
  return { event: 'oracle.requested', summary: question };
}
export function failureEvent(state, event, summary) {
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures === 2 && (state.oracle?.consultations ?? 0) < 2) {
    return requestOracle(state, 'implementer', 'Two consecutive candidate failures. Investigate before another repair. ' + summary);
  }
  return { event, summary };
}
// All durable evidence is written by the adapter, outside model-controlled files.
export function acceptResponse(state, role, response, before, after) {
  if (readOnlyRoles.has(role) && before !== after) throw new Error('Read-only ' + role + ' changed candidate contents');
  if (before !== after || role === 'implementer') invalidateCandidate(state);
  if (response.event === 'task.blocked') return response;
  if (response.event === 'oracle.requested') return requestOracle(state, role, response.summary);
  if (['product', 'planner'].includes(role)) {
    const criteria = response.acceptance;
    if (!criteria.length || !unique(criteria, 'id') || criteria.some(c => !nonempty(c.id) || !nonempty(c.criterion))) {
      throw new Error('Acceptance criteria must be nonempty and have unique IDs');
    }
    const canonical = criteria.map(c => ({ id: c.id, criterion: c.criterion })).sort((a, b) => a.id.localeCompare(b.id));
    const hash = digest({ task: state.task, criteria: canonical });
    if (state.requirements && state.requirements.hash !== hash) throw new Error('Acceptance changed during delivery; stop for an explicit scope clarification');
    state.requirements = { criteria: canonical, hash };
    if (role === 'planner') {
      if (response.specialists.some(name => !specialistNames.includes(name))) throw new Error('Unknown specialist');
      state.specialists = [...new Set([...response.specialists, ...(state.taskProfile === 'sensitive' ? ['security', 'protocol'] : [])])];
      state.plan = { summary: response.summary, requirementsHash: hash };
    }
  }
  if (role === 'qa-planner') {
    const scenarios = response.scenarios;
    const ids = state.requirements?.criteria.map(c => c.id) ?? [];
    if (!ids.length || !scenarios.length || !unique(scenarios, 'id') || scenarios.some(s => !nonempty(s.id)
      || !nonempty(s.steps) || !nonempty(s.expected) || !Array.isArray(s.acceptanceIds) || !s.acceptanceIds.length
      || s.acceptanceIds.some(id => !ids.includes(id))) || ids.some(id => !scenarios.some(s => s.acceptanceIds.includes(id)))) {
      throw new Error('QA scenarios must cover every acceptance criterion with concrete steps and expected behavior');
    }
    state.qaPlan = { scenarios, requirementsHash: state.requirements.hash, hash: digest({ requirements: state.requirements.hash, scenarios }) };
    invalidateCandidate(state);
  }
  if (role === 'reviewer') {
    if (!state.qaPlan) throw new Error('Review requires an independent QA plan');
    state.review = { ...response, fingerprint: after, requirementsHash: state.requirements.hash };
  }
  if (role === 'qa') {
    if (state.review?.event !== 'review.passed' || state.review.fingerprint !== after) throw new Error('QA requires a currently reviewed candidate');
    const results = response.results;
    const scenarios = state.qaPlan?.scenarios ?? [];
    if (!scenarios.length || !unique(results, 'scenarioId') || results.length !== scenarios.length || results.some(r =>
      !scenarios.some(s => s.id === r.scenarioId) || !['passed', 'failed', 'blocked'].includes(r.status) || !nonempty(r.evidence))) {
      throw new Error('QA must report evidence for every planned scenario');
    }
    if (response.event === 'qa.passed' && results.some(r => r.status !== 'passed')) throw new Error('QA cannot pass failed or blocked scenarios');
    state.qa = { ...response, fingerprint: after, requirementsHash: state.requirements.hash, planHash: state.qaPlan.hash };
  }
  if (role === 'oracle') {
    if (!state.oracle?.pending) throw new Error('Unsolicited Oracle completion');
    const event = state.oracle.pending.returnEvent;
    state.oracle.lastAdvice = response.summary;
    state.oracle.pending = null;
    return { event, summary: response.summary };
  }
  if (['review.rejected', 'qa.failed'].includes(response.event)) return failureEvent(state, response.event, response.summary);
  return response;
}
