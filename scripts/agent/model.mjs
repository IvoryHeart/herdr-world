import { readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { fingerprint } from './lib.mjs';
import { inContainer } from './environment.mjs';
import { readOnlyRoles } from './workflow.mjs';
import { openSession, saveSession, observeSessionLine, snapshotTree, contextDelta, writeDelta } from './sessions.mjs';

export function modelArguments(role, selected, session) {
  return ['/opt/harness/node_modules/.bin/codex', 'exec',
    ...(session.resumed ? ['resume', session.meta.threadId] : []),
    ...(!session.persistent ? ['--ephemeral'] : []),
    '--json', '--ignore-user-config', '--model', selected.model,
    '-c', 'sandbox_mode="danger-full-access"',
    '-c', 'model_reasoning_effort=' + JSON.stringify(selected.reasoningEffort),
    '--output-schema', '/control/harness/schemas/' + role + '.json', '-'];
}
export async function invokeModel(runDir, state, role) {
  const workspace = join(runDir, 'workspace'), control = join(runDir, 'control');
  const before = await fingerprint(workspace);
  const beforeTree = await snapshotTree(runDir, workspace);
  const session = await openSession(runDir, state, role);
  const delta = await writeDelta(runDir, workspace, session, beforeTree, state.activations, state.workspaceBaseline);
  const handoverRoot = state.environment === 'harbor' ? join(runDir, 'handovers') : '/handover';
  delta.patch = join(handoverRoot, basename(delta.patch));
  const instructions = await readFile(join(control, 'harness/roles', role + '.md'), 'utf8');
  const packet = {
    task: state.task, taskProfile: state.taskProfile,
    acceptance: state.requirements?.criteria ?? [], plan: state.plan?.summary ?? null,
    qaScenarios: state.qaPlan?.scenarios ?? [], specialists: state.specialists ?? [],
    intake: state.intake?.summary ?? null,
    feedback: state.feedback ?? null, previousFailure: state.reason ?? null,
    oracleQuestion: role === 'oracle' ? state.oracle?.pending : null,
    oracleAdvice: state.oracle?.lastAdvice ?? null,
  };
  const changes = contextDelta(session.resumed ? session.meta.context : null, packet);
  const specialistInstructions = role === 'reviewer' && state.specialists?.length
    ? '\n\n' + await readFile(join(control, 'harness/roles/specialists.md'), 'utf8') : '';
  const prompt = instructions + specialistInstructions + '\n\n' +
    (session.resumed ? 'Continue your own saved session. Unchanged supervisor fields retain their previous values.\n' : 'Begin this role session.\n') +
    'Supervisor context updates:\n' + JSON.stringify(changes, null, 2) +
    '\n\nCandidate changes since your session last observed it:\n' + JSON.stringify(delta, null, 2) +
    '\nThe patch and structured handovers are available at ' + handoverRoot + '. The supervisor owns these records. ' +
    'Inspect changed behavior and affected dependencies; earlier findings are not an exhaustive review checklist. ' +
    'Preserve useful source references in your summary. Retrieve additional context when a concrete gap remains; avoid repeating completed exploration. ' +
    'Return the JSON required by this role schema, using empty role arrays when asking questions, blocking or requesting advice. ' +
    'The supervisor owns routing, acceptance, budgets and publishing. Do not run ralph emit, publish, or connect to live deployments.';
  const selected = state.models[role];
  session.meta.status = 'running'; session.meta.role = role; session.meta.pid = process.pid;
  // Save the delivered packet before starting. A resumed interrupted turn still gets a
  // fresh candidate delta and any failure/owner updates, without losing the thread ID.
  session.meta.context = packet;
  saveSession(session);
  const result = await inContainer(state, workspace, modelArguments(role, selected, session), {
    control, authFile: state.authFile, network: 'bridge', readOnly: readOnlyRoles.has(role),
    sessionHome: session.persistent ? session.home : undefined, handovers: join(runDir, 'handovers'),
    input: prompt, stream: false, timeoutMs: Math.min(900000, Math.max(1, state.deadline - Date.now())),
    log: join(runDir, 'turn-' + state.activations + '.jsonl'),
    onStdoutLine: line => observeSessionLine(session, line),
  });
  const messages = [];
  let usage = null;
  for (const line of result.stdout.split('\n')) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') messages.push(event.item.text);
      if (event.type === 'turn.completed') usage = event.usage;
    } catch { /* Diagnostics stay in the private log. */ }
  }
  const after = await fingerprint(workspace);
  const afterTree = await snapshotTree(runDir, workspace);
  session.meta.status = result.code === 0 ? 'idle' : 'interrupted';
  session.meta.lastTree = afterTree; session.meta.turns += 1;
  saveSession(session);
  state.sessions ??= {};
  state.sessions[session.group] = {
    threadId: session.persistent ? session.meta.threadId : null,
    turns: session.meta.turns, status: session.meta.status,
  };
  state.turns.push({ role, ...selected, elapsedMs: result.elapsedMs, usage, costUsd: null, code: result.code,
    sessionGroup: session.group, sessionId: session.persistent ? session.meta.threadId : null,
    resumed: session.resumed, candidateTree: afterTree });
  return { result, before, after, afterTree, output: messages.at(-1),
    sessionError: session.error ?? (session.persistent && !session.meta.threadId ? 'Codex did not report a resumable thread ID' : null) };
}
