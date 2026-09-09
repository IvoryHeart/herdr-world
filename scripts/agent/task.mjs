import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { git, jsonFile, primaryCheckout, fingerprint, errorExit } from './lib.mjs';
import { candidateGate, loadState } from './run-state.mjs';
import { readLedger, summarizeUsage } from './usage.mjs';

const taskPath = cwd => join(cwd, '.agents/state/task.json');
export async function readTask(cwd = process.cwd()) {
  try { return JSON.parse(await readFile(taskPath(cwd), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function recordTask(cwd, fields) {
  const task = { schemaVersion: 1, worktree: await realpath(cwd), branch: git(['branch', '--show-current'], cwd),
    recordedAt: new Date().toISOString(), ...fields };
  if (!task.branch || task.branch === 'main') throw new Error('Task records require a non-main branch');
  await jsonFile(taskPath(cwd), task);
  return task;
}
export async function recordInteractive(cwd, reason, note, base) {
  if (!['harness-maintenance', 'owner-request'].includes(reason) || !note?.trim()) {
    throw new Error('Interactive work needs --reason harness-maintenance|owner-request and --note describing existing authorization');
  }
  const previous = await readTask(cwd);
  if (previous?.mode === 'ralph') throw new Error('Cannot silently replace a Ralph task with interactive work; preserve this run and use a separate explicitly authorized task');
  if (previous && (previous.worktree !== await realpath(cwd) || previous.branch !== git(['branch', '--show-current'], cwd))) {
    throw new Error('Task execution record belongs to a different worktree or branch');
  }
  if (previous?.base && base !== undefined && base !== previous.base) {
    throw new Error('Resuming with a different parent is not allowed; preserve the existing task record before recording a new task');
  }
  const parent = base ?? previous?.base;
  if (!parent?.trim()) throw new Error('First interactive task needs --base <parent-ref>; use the actual PR parent, not an assumed main');
  // A moving parent branch must not rewrite the recorded starting revision on resume.
  const baseRevision = parent === previous?.base && previous.baseRevision
    ? previous.baseRevision : git(['rev-parse', '--verify', '--end-of-options', parent + '^{commit}'], cwd);
  return recordTask(cwd, { mode: 'interactive', reason, note: note.trim(), base: parent, baseRevision });
}

export async function draftEvidence(cwd = process.cwd(), base) {
  const task = await readTask(cwd);
  if (!task || task.worktree !== await realpath(cwd) || task.branch !== git(['branch', '--show-current'], cwd)
    || (base && task.base !== base)) throw new Error('Draft needs the matching recorded task and parent');
  if (task.mode === 'interactive') return { ...await deliveryEvidence(cwd, base), draft: true };
  if (!/^[a-f0-9-]{36}$/.test(task.runId ?? '')) throw new Error('Draft needs a recorded run');
  const state = await loadState(join(primaryCheckout(cwd), '.agents/runs', task.runId));
  if (['running', 'preparing'].includes(state.status)) throw new Error('Pause at a coherent checkpoint before publishing a draft');
  if (await realpath(state.delivery.worktree) !== await realpath(cwd) || state.delivery.base !== task.base) throw new Error('Draft run belongs to another task');
  return { mode: 'ralph', draft: true, runId: state.id, workflow: state.workflow, outcome: state.status };
}
export async function deliveryEvidence(cwd = process.cwd(), base) {
  const task = await readTask(cwd);
  if (!task) throw new Error('No task execution record. Start the feature with agent:goal; harness maintenance or an explicit owner exception must be recorded with agent:task interactive');
  if (task.worktree !== await realpath(cwd) || task.branch !== git(['branch', '--show-current'], cwd)) {
    throw new Error('Task execution record belongs to a different worktree or branch');
  }
  if (task.mode === 'interactive') {
    if (!['harness-maintenance', 'owner-request'].includes(task.reason) || !task.note?.trim()) throw new Error('Invalid interactive exception');
    return { mode: 'interactive', reason: task.reason, harnessRun: false, costUsd: null };
  }
  if (task.mode !== 'ralph' || !/^[a-f0-9-]{36}$/.test(task.runId ?? '')) throw new Error('Ralph task has no recorded run yet; inspect its background job');
  const runDir = join(primaryCheckout(cwd), '.agents/runs', task.runId);
  const state = await candidateGate(runDir);
  if (state.id !== task.runId || await realpath(state.delivery.worktree) !== await realpath(cwd)
    || (base && state.delivery.base !== base)) throw new Error('Run delivery worktree or parent branch does not match this PR');
  const current = await fingerprint(cwd);
  if (current !== state.verification.fingerprint) throw new Error('Delivered source differs from the reviewed Ralph candidate; apply candidate.patch exactly or resume the run for repairs');
  const ledger = await readLedger(runDir);
  const identity = turn => turn?.sessionId ?? ledger.findLast(r => r.type === 'session.started' && r.attemptId === turn?.attemptId)?.sessionId;
  if (state.workflow === 'pair') {
    const proposal = state.turns.find(t => t.activation === state.pair.proposal.activation);
    const approval = state.turns.find(t => t.activation === state.pair.approval.activation);
    const lead = state.turns.find(t => t.activation === state.pair.leadApproval.activation);
    const writers = state.turns.filter(t => ['pair-a', 'pair-b'].includes(t.role));
    if (!identity(proposal) || !identity(approval) || identity(proposal) === identity(approval)
      || !identity(lead) || writers.some(t => identity(t) === identity(lead))
      || approval?.event !== 'pair.accepted' || lead?.event !== 'lead.accepted') throw new Error('Pair acceptance needs the other native history and independent lead acceptance');
  } else {
    const implementations = state.turns.filter(t => t.role === 'implementer');
    const review = state.turns.findLast(t => t.role === 'reviewer' && t.event === 'review.passed' && t.code === 0);
    const qa = state.turns.findLast(t => t.role === 'qa' && t.event === 'qa.passed' && t.code === 0);
    if (!implementations.length || !identity(review) || !identity(qa)
      || implementations.some(t => !identity(t) || [identity(review), identity(qa)].includes(identity(t)))) {
      throw new Error('Independent native review/QA history is missing or was used for implementation');
    }
  }
  const usage = summarizeUsage(ledger);
  const roles = [...new Set(state.turns.map(t => t.role))].map(role => {
    const attempts = usage.attempts.filter(a => a.role === role);
    const measured = attempts.filter(a => a.usage);
    return { role, ...state.models[role], invocations: state.turns.filter(t => t.role === role).length,
      responses: attempts.reduce((n, a) => n + a.responses, 0),
      input: measured.length ? measured.reduce((n, a) => n + a.usage.input_tokens, 0) : null,
      cached: measured.length ? measured.reduce((n, a) => n + a.usage.cached_input_tokens, 0) : null,
      output: measured.length ? measured.reduce((n, a) => n + a.usage.output_tokens, 0) : null };
  });
  return { mode: 'ralph', runId: state.id, workflow: state.workflow, outcome: state.status,
    sourceRevision: state.sourceRevision, candidateFingerprint: current, parent: state.delivery.parent,
    recovery: state.recovery ? { previousRun: state.recovery.fromRunId, lineage: state.recovery.lineage, previousRemainingMs: state.recovery.previousRemainingMs, authorizedModelMs: state.recovery.authorizedModelMs } : null,
    review: 'passed', qa: 'passed', verification: state.verification.status,
    oracleConsultations: state.oracle?.consultations ?? 0, roles,
    usageCoverage: !usage.attempts.length ? 'unavailable' : usage.lowerBound ? 'lower-bound' : 'native-responses', costUsd: null };
}
export function executionMarkdown(evidence) {
  if (evidence.draft) return '\n\nExecution: **' + evidence.mode + '**; incomplete draft checkpoint. Final review, acceptance and verification are not claimed.\n';
  if (evidence.mode === 'interactive') return '\n\nExecution: **interactive** (' + evidence.reason + '). No Ralph run; this delivery is not an autonomous harness trial.\n';
  const cell = value => String(value ?? 'unavailable').replace(/[|\r\n]/g, ' ');
  return '\n\nExecution: **Ralph**, run `' + evidence.runId + '` (' + evidence.workflow + '). ' +
    (evidence.workflow === 'pair' ? 'Pair review, behavioral evidence, required checks and lead acceptance passed. Oracle consultations: ' : 'Independent review, behavioral QA and exact-candidate verification passed. Oracle consultations: ') + evidence.oracleConsultations + '.\n\n' +
    '| Role | Model / effort | Calls | Responses | Input | Cached input | Output |\n' +
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |\n' + evidence.roles.map(r =>
      '| ' + [r.role, r.model + ' / ' + r.reasoningEffort, r.invocations, r.responses, r.input, r.cached, r.output].map(cell).join(' | ') + ' |').join('\n') +
    '\n\nUsage coverage: ' + evidence.usageCoverage + '. Cached input is included in input. Monetary/subscription cost is unmeasured.\n' + (evidence.recovery ? '\nRecovery retained prior run evidence and remaining authorization. The table covers this run only; earlier usage is retained in the recovery lineage.\n' : '');
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    reason: { type: 'string' }, note: { type: 'string' }, base: { type: 'string' },
  } });
  const action = positionals[0] ?? 'status';
  if (action === 'interactive') console.log(JSON.stringify(await recordInteractive(process.cwd(), values.reason, values.note, values.base), null, 2));
  else if (action === 'report') {
    const evidence = await deliveryEvidence(process.cwd(), values.base);
    await jsonFile(join(process.cwd(), '.agents/state/execution.json'), evidence);
    console.log(executionMarkdown(evidence));
  } else if (action === 'status') {
    const task = await readTask();
    if (!task) throw new Error('No task execution record; use agent:goal for a feature');
    const state = task.runId ? await loadState(join(primaryCheckout(), '.agents/runs', task.runId)) : null;
    console.log(JSON.stringify({ ...task, outcome: state?.status, questions: state?.intake?.questions }, null, 2));
  } else throw new Error('Usage: agent:task status|report|interactive --reason <reason> --note <authorization> [--base <parent-ref>]');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(errorExit);
