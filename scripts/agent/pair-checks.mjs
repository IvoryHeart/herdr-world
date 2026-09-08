import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fingerprint, jsonFile } from './lib.mjs';
import { inContainer, prepareDependencies } from './environment.mjs';
import { changedPaths, protectedPaths, saveState } from './run-state.mjs';
import { pairCurrent, partnerEvent } from './pair.mjs';
import { recordEvent } from './usage.mjs';

export const requiredChecks = profile => profile === 'acceptance'
  ? ['check', 'test:e2e', 'test:security', 'test:independence'] : ['check'];
export function failureKind(result) {
  if (result.interrupted) return 'interrupted';
  if (result.timedOut) return 'timeout';
  if (result.code === 0) return 'passed';
  if (/ENOSPC|no space left|EAI_AGAIN|ECONNRESET|ETIMEDOUT|Cannot connect to the Docker daemon/i.test(result.output ?? '')) return 'infrastructure';
  return 'assertion';
}
// Passed commands are reusable only for the same complete source, image and command.
// Conservative whole-source invalidation remains at final verification, never per hat.
export async function verifyPair(runDir, state, { execute = inContainer, prepare = prepareDependencies } = {}) {
  const workspace = join(runDir, 'workspace'), control = join(runDir, 'control');
  const current = await fingerprint(workspace);
  if (!pairCurrent(state, current)) return { event: partnerEvent(state.pair?.returnTo), summary: 'Review the current candidate before acceptance checks.' };
  const protectedChanges = changedPaths(workspace, state.workspaceBaseline).filter(path => protectedPaths.test(path));
  if (protectedChanges.length) return { event: 'task.blocked', summary: 'Control or dependency changes need interactive review: ' + protectedChanges.join(', ') };
  const prepared = await prepare(state, workspace, control, { timeoutMs: state.commandTimeoutMs });
  if (prepared.code !== 0) return { event: 'task.blocked', summary: 'Preparation failed. Resume this run after repairing the environment; see bootstrap.log.' };
  state.checks ??= {};
  for (const name of requiredChecks(state.profile)) {
    const previous = state.checks[name];
    if (previous?.status === 'passed' && previous.fingerprint === current && previous.image === state.image) continue;
    let result, kind;
    for (let retry = 0; retry < 2; retry++) {
      recordEvent(runDir, 'check.started', { runId: state.id, command: name, retry, timeoutMs: state.commandTimeoutMs });
      const expected = previous?.elapsedMs ? Math.max(120000, previous.elapsedMs * 1.5) : 1200000;
      result = await execute(state, workspace, ['npm', 'run', name], { control,
        network: name === 'test:security' ? 'bridge' : 'none', timeoutMs: state.commandTimeoutMs,
        checkpointMs: Math.min(expected, state.commandTimeoutMs * .8),
        onCheckpoint: () => recordEvent(runDir, 'health.warning', { runId: state.id, command: name, reason: 'Check exceeds expected duration; continue observing within its safety ceiling.' }),
        stream: false, log: join(runDir, 'check-' + name.replaceAll(':', '-') + '-' + retry + '.log') });
      kind = failureKind(result);
      state.checks[name] = { argv: ['npm', 'run', name], status: kind, code: result.code, timedOut: Boolean(result.timedOut),
        elapsedMs: result.elapsedMs, fingerprint: current, image: state.image };
      recordEvent(runDir, 'check.finished', { runId: state.id, command: name, ...state.checks[name] });
      await saveState(runDir, state);
      // One immediate retry for transient infrastructure, not for test assertions or
      // safety deadlines. Neither infrastructure outcome spends another model turn.
      if (kind !== 'infrastructure') break;
    }
    if (kind !== 'passed') {
      await mkdir(join(workspace, '.ralph/agent'), { recursive: true });
      await writeFile(join(workspace, '.ralph/agent/verification.log'), result.output.slice(-64000));
      state.verification = { status: kind, fingerprint: current };
      if (kind !== 'assertion') return { event: 'task.blocked', summary: name + ' ended with ' + kind + '. Repair/resume this step; no code-repair loop was started.' };
      const signature = name + ':' + current;
      state.checkFailures = signature === state.lastCheckFailure ? (state.checkFailures ?? 0) + 1 : 1;
      state.lastCheckFailure = signature;
      state.feedback = { role: 'verifier', summary: name + ' failed. Inspect .ralph/agent/verification.log. Preserve passing behavior; do not relax controls to claim success.' };
      if (state.checkFailures >= 2) return { event: 'task.blocked', summary: 'The same candidate failed the same check twice. Lead/owner diagnosis is required.' };
      state.pair.approval = null;
      return { event: partnerEvent(state.pair.returnTo), summary: state.feedback.summary };
    }
  }
  if (current !== await fingerprint(workspace)) return { event: 'task.blocked', summary: 'Source changed during acceptance checks; inspect concurrent writes before resuming.' };
  state.verification = { schemaVersion: 1, profile: state.profile, status: 'passed', fingerprint: current,
    requirementsHash: state.requirements.hash, checks: requiredChecks(state.profile).map(name => state.checks[name]), finishedAt: new Date().toISOString() };
  await jsonFile(join(workspace, '.agents/state/verification.json'), state.verification);
  state.pair.returnTo = state.pair.proposal.role;
  return { event: 'lead.start', summary: 'Required checks passed. Lead: assess task scope, behavioral evidence and remaining risks; accept or request a concrete correction.' };
}
