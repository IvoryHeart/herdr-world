import { readFile, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { command, fingerprint, errorExit } from './lib.mjs';
import { loadState, saveState, checkBudget, parseResponse, changedPaths, protectedPaths } from './run-state.mjs';
import { inContainer, copyCandidate, prepareDependencies } from './environment.mjs';
import { acceptResponse, evidenceCurrent, failureEvent, initialEvent } from './workflow.mjs';
import { invokeModel } from './model.mjs';
import { recordHandover } from './sessions.mjs';
import { stageAllowance } from './budgets.mjs';
import { readLedger, attemptsFromLedger, recordEvent } from './usage.mjs';

async function inputPrompt() {
  const args = process.argv.slice(3);
  const p = args.indexOf('-p');
  if (p >= 0) return args[p + 1];
  if (args.length) return args.at(-1);
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input;
}
async function emit(runDir, state, event, summary) {
  state.lastEvent = event;
  if (event === 'task.blocked') { state.status = 'blocked'; state.reason = summary; }
  await saveState(runDir, state);
  const result = await command([join(runDir, 'control/harness/bin/ralph'), 'emit', event, summary],
    { cwd: join(runDir, 'workspace'), stream: false });
  if (result.code !== 0) throw new Error('Ralph event emission failed: ' + result.output);
  console.log(summary);
}
async function main() {
  const runDir = process.env.WORLD_AGENT_RUN;
  if (!runDir) throw new Error('Use agent:run to establish the execution boundary');
  const role = process.argv[2];
  const state = await loadState(runDir);
  const workspace = join(runDir, 'workspace');
  const control = join(runDir, 'control');
  await inputPrompt(); // Ralph owns events; the adapter supplies the bounded role context.
  checkBudget(state);
  state.activations += 1;
  await saveState(runDir, state);
  if (role === 'coordinator') {
    if (state.status === 'ready-for-review') return emit(runDir, state, 'LOOP_COMPLETE', 'Candidate has current review and verification.');
    return emit(runDir, state, state.lastEvent ?? initialEvent(state.taskProfile), 'Continue the authorized task through the configured roles.');
  }
  const allowance = stageAllowance(state, role, attemptsFromLedger(await readLedger(runDir)));
  if (allowance.timeoutMs < 1000) return emit(runDir, state, 'task.blocked', allowance.stage +
    ' stage budget exhausted. Inspect the checkpoint and recorded usage before authorizing further work.');
  if (role === 'verifier') {
    const attempt = recordEvent(runDir, 'attempt.started', { runId: state.id, attemptId: randomUUID(), activation: state.activations,
      role, stage: allowance.stage, timeoutMs: allowance.timeoutMs });
    const verificationDeadline = Math.min(state.deadline, Date.now() + allowance.timeoutMs);
    let verifierCode = 1;
    try {
    const current = await fingerprint(workspace);
    if (!evidenceCurrent(state, current)) {
      return emit(runDir, state, 'verification.failed', 'Candidate acceptance, review or QA is missing or stale; request another review.');
    }
    const protectedChanges = changedPaths(workspace, state.workspaceBaseline).filter(p => protectedPaths.test(p));
    if (protectedChanges.length) return emit(runDir, state, 'task.blocked',
      'Harness/check-control or dependency changes require an interactive review: ' + protectedChanges.join(', '));
    const verificationDir = join(runDir, 'verification-' + state.activations);
    await copyCandidate(workspace, verificationDir);
    const prepared = await prepareDependencies(state, verificationDir, control, { timeoutMs: Math.max(1, verificationDeadline - Date.now()) });
    let result = prepared;
    let securityAudit;
    if (result.code === 0 && state.profile === 'acceptance') {
      // Advisory services require egress; this phase has no model credential.
      result = await inContainer(state, verificationDir, ['npm', 'run', 'test:security'],
        { control, network: 'bridge', timeoutMs: Math.max(1, verificationDeadline - Date.now()), log: join(runDir, 'security.log') });
      securityAudit = { code: result.code, elapsedMs: result.elapsedMs };
    }
    if (result.code === 0) result = await inContainer(state, verificationDir,
      ['node', '/control/scripts/agent/verify.mjs', state.profile === 'acceptance' ? 'acceptance-offline' : state.profile],
      { control, timeoutMs: Math.max(1, verificationDeadline - Date.now()), log: join(runDir, 'verification.log') });
    if (result.code === 0) {
      const receipt = JSON.parse(await readFile(join(verificationDir, '.agents/state/verification.json'), 'utf8'));
      if (receipt.status === 'passed' && receipt.fingerprint === current && current === await fingerprint(workspace)) {
        state.verification = { ...receipt, profile: state.profile, securityAudit, requirementsHash: state.requirements.hash };
        state.status = 'ready-for-review';
        state.consecutiveFailures = 0;
        verifierCode = 0;
        return emit(runDir, state, 'candidate.verified', 'Independent checks passed for the reviewed candidate.');
      }
    }
    state.verification = { status: 'failed', fingerprint: current };
    await mkdir(join(workspace, '.ralph/agent'), { recursive: true });
    await writeFile(join(workspace, '.ralph/agent/verification.log'), result.output.slice(-64000));
    const next = failureEvent(state, 'verification.failed', 'Independent checks failed; inspect .ralph/agent/verification.log.');
    state.feedback = { role, event: 'verification.failed', summary: next.summary };
    return emit(runDir, state, next.event, next.summary);
    } finally {
      recordEvent(runDir, 'attempt.finished', { runId: state.id, attemptId: attempt.attemptId, code: verifierCode });
    }
  }
  const { result, before, after, afterTree, output, sessionError } = await invokeModel(runDir, state, role);
  if (result.code !== 0 || sessionError) {
    state.consecutiveFailures += 1;
    state.reason = sessionError ?? 'Backend failed; see turn-' + state.activations + '.jsonl';
    await saveState(runDir, state);
    throw new Error(state.reason);
  }
  let response;
  try { response = parseResponse(output, role); }
  catch (error) {
    state.consecutiveFailures += 1;
    state.reason = 'Invalid backend response: ' + error.message;
    await saveState(runDir, state);
    throw error;
  }
  let next;
  try { next = acceptResponse(state, role, response, before, after); }
  catch (error) {
    state.consecutiveFailures += 1; state.reason = error.message;
    await saveState(runDir, state); throw error;
  }
  state.reason = null;
  if (['review.rejected', 'qa.failed'].includes(response.event)) state.feedback = { role, ...response };
  state.turns.at(-1).event = response.event;
  await recordHandover(runDir, state, role, response, afterTree);
  await mkdir(join(workspace, '.ralph/agent'), { recursive: true });
  await writeFile(join(workspace, '.ralph/agent', role + '.md'), response.summary + '\n');
  await appendFile(join(workspace, '.ralph/agent/scratchpad.md'), '\n## ' + role + ': ' + response.event + '\n' + response.summary + '\n');
  return emit(runDir, state, next.event, next.summary);
}
main().catch(errorExit);
