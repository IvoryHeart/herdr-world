import { readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { fingerprint, jsonFile } from './lib.mjs';
import { inContainer } from './environment.mjs';
import { readOnlyRoles } from './workflow.mjs';
import { openSession, saveSession, observeSessionLine, snapshotTree, contextDelta, writeDelta } from './sessions.mjs';
import { stageAllowance } from './budgets.mjs';
import { readLedger, attemptsFromLedger, startUsage, recordEvent, normalizeUsage } from './usage.mjs';
import { telemetryArguments, flushTelemetry } from './telemetry.mjs';
import { changedPaths } from './run-state.mjs';
import { readRunRecap } from './progress.mjs';

export async function roleInstructions(control, role) {
  const own = await readFile(join(control, 'harness/roles', role + '.md'), 'utf8');
  return ['pair-a', 'pair-b'].includes(role)
    ? own + '\n' + await readFile(join(control, 'harness/roles/pair.md'), 'utf8') : own;
}

export function modelArguments(role, selected, session, telemetry, referenceImages = []) {
  return ['/opt/harness/node_modules/.bin/codex', 'exec',
    ...(session.resumed ? ['resume', session.meta.threadId] : []),
    '--json', '--ignore-user-config', '--model', selected.model,
    '-c', 'sandbox_mode="danger-full-access"',
    '-c', 'model_reasoning_effort=' + JSON.stringify(selected.reasoningEffort),
    '-c', 'agents.enabled=false',
    ...telemetryArguments(telemetry),
    ...referenceImages.flatMap(path => ['--image', path]),
    '--output-schema', '/control/harness/schemas/' + role + '.json', '-'];
}
export async function invokeModel(runDir, state, role) {
  const workspace = join(runDir, 'workspace'), control = join(runDir, 'control');
  const before = await fingerprint(workspace);
  const beforeTree = await snapshotTree(runDir, workspace);
  const session = await openSession(runDir, state, role);
  const allowance = stageAllowance(state, role, attemptsFromLedger(await readLedger(runDir)));
  if (allowance.timeoutMs < 1000) throw new Error(allowance.stage + ' stage budget exhausted; checkpoint retained for owner assessment');
  const delta = await writeDelta(runDir, workspace, session, beforeTree, state.activations, state.workspaceBaseline);
  const handoverRoot = state.environment === 'harbor' ? join(runDir, 'handovers') : '/handover';
  delta.patch = join(handoverRoot, basename(delta.patch));
  const instructions = await roleInstructions(control, role);
  const packet = {
    task: state.task, taskProfile: state.taskProfile,
    pair: state.pair ?? null, recovery: state.recovery ?? null,
    // Only handoff/checkpoint facts belong in model context, not a growing metrics ledger.
    recap: await readRunRecap(runDir).then(({ completed, findings, blockedReason, nextEvent }) => ({ completed, findings, blockedReason, nextEvent })),
    reviewBase: state.reviewBase ?? state.workspaceBaseline,
    referenceImages: (state.referenceImages ?? []).map(ref => ({ ...ref,
      file: join(state.environment === 'harbor' ? control : '/control', ref.file) })),
    acceptance: state.requirements?.criteria ?? [], plan: state.plan?.summary ?? null,
    qaScenarios: state.qaPlan?.scenarios ?? [], specialists: state.specialists ?? [],
    intake: state.intake?.summary ?? null,
    feedback: state.feedback ?? null, previousFailure: state.reason ?? null,
    oracleQuestion: role === 'oracle' ? state.oracle?.pending : null,
    oracleAdvice: state.oracle?.lastAdvice ?? null,
    verification: state.verification ? { status: state.verification.status, fingerprint: state.verification.fingerprint,
      checks: state.verification.checks?.map(({ argv, status, code, elapsedMs }) => ({ argv, status, code, elapsedMs })) } : null,
  };
  const changes = contextDelta(session.resumed ? session.meta.context : null, packet);
  const specialistInstructions = ['reviewer', 'pair-a', 'pair-b', 'lead'].includes(role) && state.specialists?.length
    ? '\n\n' + await readFile(join(control, 'harness/roles/specialists.md'), 'utf8') : '';
  const prompt = instructions + specialistInstructions + '\n\n' +
    'Current phase: ' + role + '. Its permissions and output schema replace those of your previous phase. ' +
    'You are already inside the recorded harness run. Do not start agent:goal, agent:run, another worktree or another orchestrator; follow this phase and return its schema. ' +
    'Repository root: ' + (state.environment === 'harbor' ? workspace : '/workspace') + '. Do not append a repository name to this path.\n' +
    'Phase budget: ' + Math.floor(allowance.timeoutMs / 1000) + ' seconds, including shutdown. Aim to finish by ' +
    new Date(Date.now() + allowance.timeoutMs * .8).toISOString() + '. Keep the final summary concise with file references and concrete unfinished work if blocked.\n' +
    (session.resumed ? 'Continue your own saved session. Unchanged supervisor fields retain their previous values.\n' : 'Begin this role session.\n') +
    'Supervisor context updates:\n' + JSON.stringify(changes, null, 2) +
    '\n\nCandidate changes since your session last observed it:\n' + JSON.stringify(delta, null, 2) +
    '\nThe patch is available at ' + delta.patch + '. Read a specific structured handover under ' + handoverRoot + ' only to resolve a concrete gap; do not read every handover. ' +
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
  let firstPatch = (await readLedger(runDir)).some(r => r.type === 'candidate.changed'), lastSourceCheck = 0;
  const tracker = await startUsage(runDir, state, role, session, allowance, () => {
    if (!['implementer', 'pair-a', 'pair-b'].includes(role) || firstPatch || Date.now() - lastSourceCheck < 5000) return;
    lastSourceCheck = Date.now();
    if (changedPaths(workspace, state.workspaceBaseline ?? 'HEAD').length) {
      firstPatch = true;
      recordEvent(runDir, 'candidate.changed', { runId: state.id, role, activation: state.activations });
    }
  });
  const checkpoint = async reason => {
    const tree = await snapshotTree(runDir, workspace);
    const observed = await writeDelta(runDir, workspace, session, tree, state.activations + '-checkpoint', state.workspaceBaseline);
    await jsonFile(join(runDir, 'checkpoints', 'attempt-' + state.activations + '.json'), {
      role, attemptId: tracker.attempt.attemptId, reason, timestamp: new Date().toISOString(), sessionId: session.meta.threadId,
      candidateTree: tree, delta: observed, lastActivityAt: session.meta.lastActivityAt ?? null,
      note: 'Supervisor snapshot, not successful review or verification. Resume supplies a fresh delta from the last completed turn.',
    });
    recordEvent(runDir, 'checkpoint', { runId: state.id, attemptId: tracker.attempt.attemptId, role, reason });
  };
  let result;
  try { result = await inContainer(state, workspace, modelArguments(role, selected, session, state.telemetry,
    packet.referenceImages.map(ref => ref.file)), {
    instanceId: tracker.attempt.instanceId,
    control, authFile: state.authFile, network: 'bridge', readOnly: readOnlyRoles.has(role),
    sessionHome: session.home, handovers: join(runDir, 'handovers'),
    input: prompt, stream: false, timeoutMs: allowance.timeoutMs, graceMs: allowance.graceMs,
    checkpointMs: Math.floor(allowance.timeoutMs * .8), onCheckpoint: checkpoint,
    log: join(runDir, 'turn-' + state.activations + '.jsonl'),
    onStdoutLine: line => {
      observeSessionLine(session, line);
      try {
        const event = JSON.parse(line);
        if (event.type === 'thread.started') recordEvent(runDir, 'session.started', { runId: state.id,
          attemptId: tracker.attempt.attemptId, instanceId: tracker.attempt.instanceId, role, sessionId: session.meta.threadId });
        if (['item.started', 'item.completed', 'turn.completed'].includes(event.type)) {
          session.meta.lastActivityAt = new Date().toISOString(); saveSession(session);
        }
        const usage = event.type === 'turn.completed' && normalizeUsage(event.usage);
        if (usage) recordEvent(runDir, 'turn.summary', { runId: state.id, attemptId: tracker.attempt.attemptId, usage });
      } catch { /* Non-JSON diagnostics stay private. */ }
    },
  }); } catch (error) {
    await tracker.finish({ code: null, interrupted: true });
    throw error;
  }
  if (state.workflow === 'pair') state.remainingMs = Math.max(0, state.remainingMs - result.elapsedMs);
  const accounted = await tracker.finish(result);
  if (result.code !== 0) await checkpoint(result.timedOut ? 'timed-out' : 'interrupted');
  await flushTelemetry(runDir, state.telemetry);
  const messages = [];
  for (const line of result.stdout.split('\n')) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') messages.push(event.item.text);
    } catch { /* Diagnostics stay in the private log. */ }
  }
  const after = await fingerprint(workspace);
  const afterTree = await snapshotTree(runDir, workspace);
  session.meta.status = result.code === 0 ? 'idle' : 'interrupted';
  if (result.code === 0) session.meta.lastTree = afterTree;
  session.meta.turns += 1;
  saveSession(session);
  state.sessions ??= {};
  state.sessions[session.group] = {
    threadId: session.persistent ? session.meta.threadId : null,
    turns: session.meta.turns, status: session.meta.status,
  };
  state.turns.push({ role, activation: state.activations, ...selected, attemptId: tracker.attempt.attemptId, elapsedMs: result.elapsedMs,
    usage: accounted.usage, usageCoverage: accounted.coverage, costUsd: null, code: result.code,
    sessionGroup: session.group, sessionId: session.persistent ? session.meta.threadId : null,
    resumed: session.resumed, changed: before !== after, candidateTree: afterTree });
  return { result, before, after, afterTree, output: messages.at(-1),
    sessionError: session.error ?? (session.persistent && !session.meta.threadId ? 'Codex did not report a resumable thread ID' : null) };
}
