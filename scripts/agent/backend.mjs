import { readFile, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { command, fingerprint, jsonFile, errorExit } from './lib.mjs';
import { loadState, saveState, checkBudget, parseResponse, changedPaths, protectedPaths } from './run-state.mjs';
import { inContainer, copyCandidate, prepareDependencies } from './environment.mjs';
import { acceptResponse, evidenceCurrent, failureEvent, initialEvent, readOnlyRoles } from './workflow.mjs';

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
  const prompt = await inputPrompt();
  checkBudget(state);
  state.activations += 1;
  await saveState(runDir, state);
  if (role === 'coordinator') {
    if (state.status === 'ready-for-review') return emit(runDir, state, 'LOOP_COMPLETE', 'Candidate has current review and verification.');
    return emit(runDir, state, state.lastEvent ?? initialEvent(state.taskProfile), 'Continue the authorized task through the configured roles.');
  }
  if (role === 'verifier') {
    const current = await fingerprint(workspace);
    if (!evidenceCurrent(state, current)) {
      return emit(runDir, state, 'verification.failed', 'Candidate acceptance, review or QA is missing or stale; request another review.');
    }
    const protectedChanges = changedPaths(workspace, state.workspaceBaseline).filter(p => protectedPaths.test(p));
    if (protectedChanges.length) return emit(runDir, state, 'task.blocked',
      'Harness/check-control or dependency changes require an interactive review: ' + protectedChanges.join(', '));
    const verificationDir = join(runDir, 'verification-' + state.activations);
    await copyCandidate(workspace, verificationDir);
    const prepared = await prepareDependencies(state, verificationDir, control);
    let result = prepared;
    let securityAudit;
    if (result.code === 0 && state.profile === 'acceptance') {
      // Advisory services require egress; this phase has no model credential.
      result = await inContainer(state, verificationDir, ['npm', 'run', 'test:security'],
        { control, network: 'bridge', timeoutMs: Math.max(1, state.deadline - Date.now()), log: join(runDir, 'security.log') });
      securityAudit = { code: result.code, elapsedMs: result.elapsedMs };
    }
    if (result.code === 0) result = await inContainer(state, verificationDir,
      ['node', '/control/scripts/agent/verify.mjs', state.profile === 'acceptance' ? 'acceptance-offline' : state.profile],
      { control, timeoutMs: Math.max(1, state.deadline - Date.now()), log: join(runDir, 'verification.log') });
    if (result.code === 0) {
      const receipt = JSON.parse(await readFile(join(verificationDir, '.agents/state/verification.json'), 'utf8'));
      if (receipt.status === 'passed' && receipt.fingerprint === current && current === await fingerprint(workspace)) {
        state.verification = { ...receipt, profile: state.profile, securityAudit, requirementsHash: state.requirements.hash };
        state.status = 'ready-for-review';
        state.consecutiveFailures = 0;
        return emit(runDir, state, 'candidate.verified', 'Independent checks passed for the reviewed candidate.');
      }
    }
    state.verification = { status: 'failed', fingerprint: current };
    await mkdir(join(workspace, '.ralph/agent'), { recursive: true });
    await writeFile(join(workspace, '.ralph/agent/verification.log'), result.output.slice(-64000));
    const next = failureEvent(state, 'verification.failed', 'Independent checks failed; inspect .ralph/agent/verification.log.');
    return emit(runDir, state, next.event, next.summary);
  }
  const before = await fingerprint(workspace);
  const instructions = await readFile(join(control, 'harness/roles', role + '.md'), 'utf8');
  const context = { taskProfile: state.taskProfile, acceptance: state.requirements?.criteria ?? [],
    plan: state.plan?.summary ?? null, qaScenarios: state.qaPlan?.scenarios ?? [],
    specialists: state.specialists ?? [], oracleQuestion: role === 'oracle' ? state.oracle?.pending : null,
    oracleAdvice: state.oracle?.lastAdvice ?? null };
  const specialistInstructions = role === 'reviewer' && state.specialists?.length
    ? '\n\n' + await readFile(join(control, 'harness/roles/specialists.md'), 'utf8') : '';
  const responsePrompt = instructions + specialistInstructions + '\n\n' + prompt + '\n\nOriginal task:\n' + state.task +
    '\n\nSupervisor-owned context (acceptance criteria are fixed until owner clarification):\n' + JSON.stringify(context, null, 2) +
    '\n\nReturn only JSON with event and summary according to the provided schema. Do not run ralph emit; the adapter emits your validated event. ' +
    'Include the structured role fields from the schema; use empty arrays when blocking or requesting Oracle advice. ' +
    'For a review inspect git diff ' + state.workspaceBaseline + ' and untracked source files. ' +
    'This container has no publishing credentials or Herdr socket. Do not connect to live deployments.';
  const selected = state.models[role];
  const argv = ['/opt/harness/node_modules/.bin/codex', 'exec', '--json', '--ephemeral',
    '--ignore-user-config', '--sandbox', 'danger-full-access', '--model', selected.model,
    '-c', 'model_reasoning_effort=' + JSON.stringify(selected.reasoningEffort),
    '--output-schema', '/control/harness/schemas/' + role + '.json', '-'];
  const started = Date.now();
  const result = await inContainer(state, workspace, argv, {
    control, authFile: state.authFile, network: 'bridge', readOnly: readOnlyRoles.has(role),
    input: responsePrompt, stream: false, timeoutMs: Math.min(900000, Math.max(1, state.deadline - Date.now())),
    log: join(runDir, 'turn-' + state.activations + '.jsonl'),
  });
  const messages = [];
  let usage = null;
  for (const line of result.stdout.split('\n')) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') messages.push(event.item.text);
      if (event.type === 'turn.completed') usage = event.usage;
    } catch { /* stderr diagnostics are retained in the private log */ }
  }
  state.turns.push({ role, ...selected, elapsedMs: Date.now() - started, usage, costUsd: null, code: result.code });
  if (result.code !== 0) {
    state.consecutiveFailures += 1;
    state.reason = 'Backend failed; see turn-' + state.activations + '.jsonl';
    await saveState(runDir, state);
    throw new Error(state.reason);
  }
  let response;
  try { response = parseResponse(messages.at(-1), role); }
  catch (error) {
    state.consecutiveFailures += 1;
    state.reason = 'Invalid backend response: ' + error.message;
    await saveState(runDir, state);
    throw error;
  }
  const after = await fingerprint(workspace);
  let next;
  try { next = acceptResponse(state, role, response, before, after); }
  catch (error) {
    state.consecutiveFailures += 1; state.reason = error.message;
    await saveState(runDir, state); throw error;
  }
  state.turns.at(-1).event = response.event;
  await mkdir(join(workspace, '.ralph/agent'), { recursive: true });
  await writeFile(join(workspace, '.ralph/agent', role + '.md'), response.summary + '\n');
  await appendFile(join(workspace, '.ralph/agent/scratchpad.md'), '\n## ' + role + ': ' + response.event + '\n' + response.summary + '\n');
  return emit(runDir, state, next.event, next.summary);
}
main().catch(errorExit);
