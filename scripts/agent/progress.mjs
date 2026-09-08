import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { jsonFile } from './lib.mjs';
import { readLedger } from './usage.mjs';

export const recapIntervalMs = 5 * 60 * 1000;
const elapsed = (since, now) => since ? Math.max(0, now - Date.parse(since)) : null;
const bounded = value => typeof value === 'string' ? value.slice(0, 1600) : null;

// A recap is an observation, never an acceptance receipt or a reason to restart work.
export function buildRecap(state, rows, { now = Date.now(), handover = null } = {}) {
  let active = null;
  const totals = {}, seen = new Set();
  for (const row of rows) {
    if (row.type === 'attempt.started') active = { kind: 'model', role: row.role, attemptId: row.attemptId, startedAt: row.timestamp };
    if (row.type === 'attempt.finished' && active?.attemptId === row.attemptId) active = null;
    if (row.type === 'check.started') active = { kind: 'check', command: row.command, startedAt: row.timestamp };
    if (row.type === 'check.finished' && active?.command === row.command) active = null;
    if (row.type === 'preparation.started') active = { kind: 'preparation', startedAt: row.timestamp };
    if (row.type === 'preparation.finished' && active?.kind === 'preparation') active = null;
    if (row.type === 'run.stopped') active = null;
    if (row.type !== 'response.usage' || seen.has(row.responseId)) continue;
    seen.add(row.responseId);
    const key = (row.role ?? 'unknown') + '/' + (row.model ?? 'unknown');
    const total = totals[key] ??= { responses: 0, input: 0, cachedInput: 0, output: 0 };
    total.responses++;
    total.input += row.usage?.input_tokens ?? 0;
    total.cachedInput += row.usage?.cached_input_tokens ?? 0;
    total.output += row.usage?.output_tokens ?? 0;
  }
  if (!['running', 'preparing'].includes(state.status)) active = null;
  const last = rows.findLast(row => !['health.disk', 'health.warning', 'storage.measured'].includes(row.type));
  const modelElapsed = active?.kind === 'model' && active.role !== 'verifier' ? elapsed(active.startedAt, now) : 0;
  return {
    schemaVersion: 1, runId: state.id, observedAt: new Date(now).toISOString(),
    status: state.status, workflow: state.workflow, elapsedMs: elapsed(state.startedAt, now),
    active: active ? { ...active, elapsedMs: elapsed(active.startedAt, now) } : null,
    nextEvent: state.resumeEvent ?? state.lastEvent ?? null,
    lastRecordedActivityAt: last?.timestamp ?? null,
    lastRecordedActivityAgeMs: elapsed(last?.timestamp, now),
    completed: handover ? { role: handover.role, event: handover.response?.event, summary: bounded(handover.response?.summary) } : null,
    findings: (handover?.response?.findings ?? []).slice(0, 12).map(f => ({ id: f.id, summary: bounded(f.summary ?? f.description) })),
    blockedReason: bounded(state.reason),
    checks: Object.entries(state.checks ?? {}).map(([command, result]) => ({ command, status: result.status, elapsedMs: result.elapsedMs })),
    pair: { handoffs: state.pair?.handoffs ?? 0, repeatedFindings: state.pair?.stalls ?? 0 },
    modelRemainingMs: Number.isFinite(state.remainingMs) ? Math.max(0, state.remainingMs - modelElapsed) : null,
    usage: { byRoleAndModel: totals, coverage: 'Recorded responses only; cached input is included in input. Coordinator and unreported responses are excluded.', costUsd: null },
    health: state.health ? { inspectedAt: state.health.inspectedAt, disks: state.health.disks.map((disk, i) => ({ kind: ['workspace', 'control', 'temporary'][i], level: disk.level, availableBytes: disk.availableBytes })) } : null,
    note: 'Silence is not proof of a stall. Check the active command, findings and recorded evidence before intervening. This recap does not change run state or allowance.',
  };
}

export async function readRunRecap(runDir, options = {}) {
  const state = JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8'));
  const turn = state.turns?.findLast(t => t.event);
  let handover = null;
  if (turn) try { handover = JSON.parse(await readFile(join(runDir, 'handovers', 'turn-' + turn.activation + '.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return buildRecap(state, await readLedger(runDir), { ...options, handover });
}

export async function readJobRecap(directory) {
  const job = JSON.parse(await readFile(join(directory, 'job.json'), 'utf8'));
  if (!job.runId) return { schemaVersion: 1, jobId: job.id, jobStatus: job.status, observedAt: new Date().toISOString(), active: ['starting', 'running'].includes(job.status) ? { kind: 'starting' } : null };
  if (!/^[a-f0-9-]{36}$/.test(job.runId)) throw new Error('Invalid job run ID');
  const recap = await readRunRecap(join(dirname(dirname(directory)), 'runs', job.runId));
  return { ...recap, active: ['starting', 'running'].includes(job.status) ? recap.active : null, jobId: job.id, jobStatus: job.status };
}

export function startRecaps(directory, { intervalMs = recapIntervalMs, read = readJobRecap, emit = console.log } = {}) {
  let pending = Promise.resolve(), busy = false;
  const publish = async () => {
    try {
      const recap = await read(directory);
      await jsonFile(join(directory, 'recap.json'), recap);
      emit('Agent recap: ' + JSON.stringify(recap));
    } catch (error) {
      // Reporting cannot kill a healthy job or rewrite its state. Surface lost visibility.
      emit('Agent recap unavailable: ' + error.message);
    }
  };
  const timer = setInterval(() => {
    if (busy) return;
    busy = true; pending = publish().finally(() => { busy = false; });
  }, intervalMs);
  timer.unref();
  return async () => { clearInterval(timer); await pending; await publish(); };
}
