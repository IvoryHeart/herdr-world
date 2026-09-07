import { appendFileSync, constants } from 'node:fs';
import { mkdir, readFile, readdir, lstat, open } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { jsonFile } from './lib.mjs';

const tokenFields = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens'];
export function normalizeUsage(usage) {
  if (!usage || !Number.isSafeInteger(usage.input_tokens) || !Number.isSafeInteger(usage.output_tokens)) return null;
  const result = Object.fromEntries(tokenFields.map(key => [key, usage[key] ?? 0]));
  if (Object.values(result).some(n => !Number.isSafeInteger(n) || n < 0)
    || result.cached_input_tokens > result.input_tokens || result.reasoning_output_tokens > result.output_tokens) return null;
  return result;
}
export async function readLedger(runDir) {
  let text;
  try { text = await readFile(join(runDir, 'usage.jsonl'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return text.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
}
export function recordEvent(runDir, type, fields = {}) {
  const row = { schemaVersion: 1, eventId: randomUUID(), timestamp: new Date().toISOString(), type, ...fields };
  // One append per record, outside any worker mount. Survives a killed adapter.
  appendFileSync(join(runDir, 'usage.jsonl'), JSON.stringify(row) + '\n', { mode: 0o600 });
  return row;
}
export function attemptsFromLedger(rows, now = Date.now()) {
  return rows.filter(r => r.type === 'attempt.started').map(start => {
    const finish = rows.find(r => r.type === 'attempt.finished' && r.attemptId === start.attemptId);
    return { ...start, ...finish, startedAt: start.timestamp, finishedAt: finish?.timestamp,
      elapsedMs: Math.max(0, (finish ? Date.parse(finish.timestamp) : now) - Date.parse(start.timestamp)),
      finished: Boolean(finish) };
  });
}
export function summarizeUsage(rows) {
  const seen = new Set();
  const responses = rows.filter(r => r.type === 'response.usage' && !seen.has(r.responseId) && seen.add(r.responseId));
  const attempts = attemptsFromLedger(rows);
  const byAttempt = attempts.map(a => {
    const records = responses.filter(r => r.attemptId === a.attemptId);
    const fallback = rows.findLast(r => r.type === 'turn.summary' && r.attemptId === a.attemptId);
    const source = records.length ? 'native-responses' : fallback ? 'turn-summary-only' : 'missing';
    const usages = records.length ? records.map(r => r.usage) : fallback ? [fallback.usage] : [];
    return { ...a, responses: records.length, coverage: source,
      usage: usages.length ? Object.fromEntries(tokenFields.map(key => [key, usages.reduce((n, u) => n + (u[key] ?? 0), 0)])) : null };
  });
  return { responses: responses.length, attempts: byAttempt,
    usage: Object.fromEntries(tokenFields.map(key => [key, byAttempt.reduce((n, a) => n + (a.usage?.[key] ?? 0), 0)])),
    // Native records include completed responses before a kill, not an unreported in-flight response.
    lowerBound: !byAttempt.length || byAttempt.some(a => a.role !== 'verifier'
      && (a.coverage !== 'native-responses' || a.code !== 0 || a.timedOut || a.interrupted || a.readError)), costUsd: null };
}
async function journalFiles(directory) {
  try { if (!(await lstat(directory)).isDirectory()) return []; }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await journalFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path);
  }
  return files;
}
// Read only newly appended bytes. Never copy transcript records into the ledger.
export function nativeReader() {
  const cursors = new Map();
  return async (home, consume) => {
    for (const file of await journalFiles(join(home, 'sessions'))) {
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        let cursor = cursors.get(file);
        if (!cursor || cursor.inode !== stat.ino || stat.size < cursor.offset) cursor = { inode: stat.ino, offset: 0, pending: '', discard: false };
        const buffer = Buffer.alloc(65536);
        while (cursor.offset < stat.size) {
          const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, stat.size - cursor.offset), cursor.offset);
          if (!bytesRead) break;
          cursor.offset += bytesRead;
          // Relevant native records are ASCII JSON. Non-usage records may contain large blobs.
          cursor.pending += buffer.subarray(0, bytesRead).toString('utf8');
          let end;
          while ((end = cursor.pending.indexOf('\n')) >= 0) {
            const line = cursor.pending.slice(0, end); cursor.pending = cursor.pending.slice(end + 1);
            if (!cursor.discard && line.includes('"token_usage_record"')) {
              try { consume(JSON.parse(line)); } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
            }
            cursor.discard = false;
          }
          if (cursor.pending.length > 1048576) { cursor.pending = ''; cursor.discard = true; }
        }
        cursors.set(file, cursor);
      } finally { await handle.close(); }
    }
  };
}
export function usageConsumer(runDir, attempts, rows) {
  const seen = new Set(rows.filter(r => r.type === 'response.usage').map(r => r.responseId));
  return record => {
    if (record.type !== 'token_usage_record') return;
    const p = record.payload, usage = normalizeUsage(p?.usage), timestamp = Date.parse(record.timestamp);
    if (!usage || typeof p.response_id !== 'string' || seen.has(p.response_id) || !Number.isFinite(timestamp)) return;
    const attempt = attempts.findLast(a => timestamp >= Date.parse(a.startedAt ?? a.timestamp)
      && (!a.finishedAt || timestamp <= Date.parse(a.finishedAt)) && (!a.sessionId || a.sessionId === p.thread_id));
    if (!attempt) return;
    seen.add(p.response_id);
    recordEvent(runDir, 'response.usage', { timestamp: record.timestamp, runId: attempt.runId,
      attemptId: attempt.attemptId, activation: attempt.activation, role: attempt.role, sessionGroup: attempt.sessionGroup,
      instanceId: attempt.instanceId,
      model: attempt.model, reasoningEffort: attempt.reasoningEffort,
      sessionId: p.thread_id, turnId: p.turn_id, responseId: p.response_id, usage });
  };
}
export async function recoverUsage(runDir, { interrupted = false, now = Date.now() } = {}) {
  let rows = await readLedger(runDir);
  const starts = rows.filter(r => r.type === 'attempt.started');
  const homes = [...new Set(starts.map(a => a.home).filter(Boolean))];
  for (const home of homes) {
    const attempts = starts.filter(a => a.home === home).map(a => {
      const finish = rows.find(r => r.type === 'attempt.finished' && r.attemptId === a.attemptId);
      return { ...a, startedAt: a.timestamp, finishedAt: finish?.timestamp };
    });
    if (home.startsWith('/') || home.split('/').includes('..')) throw new Error('Invalid recorded session home');
    const read = nativeReader();
    await read(join(runDir, home), usageConsumer(runDir, attempts, rows));
    rows = await readLedger(runDir);
  }
  if (interrupted) for (const a of attemptsFromLedger(rows, now).filter(a => !a.finished)) {
    recordEvent(runDir, 'attempt.finished', { runId: a.runId, attemptId: a.attemptId, timestamp: new Date(now).toISOString(),
      code: null, interrupted: true, recovered: true });
  }
  const summary = summarizeUsage(await readLedger(runDir));
  await jsonFile(join(runDir, 'usage-summary.json'), summary);
  return summary;
}
export async function startUsage(runDir, state, role, session, allowance, onScan) {
  await mkdir(runDir, { recursive: true });
  const attemptId = randomUUID();
  const attempt = recordEvent(runDir, 'attempt.started', { runId: state.id, attemptId, instanceId: attemptId, activation: state.activations,
    role, sessionGroup: session.group, sessionId: session.resumed ? session.meta.threadId : null,
    home: relative(runDir, session.home), ...state.models[role], stage: allowance.stage, timeoutMs: allowance.timeoutMs,
    resumed: session.resumed });
  const consume = usageConsumer(runDir, [attempt], await readLedger(runDir));
  const read = nativeReader();
  let pending = Promise.resolve(), readError;
  const scan = () => { pending = pending.then(async () => { await read(session.home, consume); await onScan?.(); }).catch(error => { readError = error.message; }); };
  const timer = setInterval(scan, 1000);
  return { attempt, scan,
    async finish(result) {
      clearInterval(timer); scan(); await pending;
      recordEvent(runDir, 'attempt.finished', { runId: state.id, attemptId: attempt.attemptId,
        instanceId: attempt.instanceId, role, ...state.models[role], sessionId: session.meta?.threadId,
        code: result.code, timedOut: result.timedOut, interrupted: result.interrupted, checkpointError: result.checkpointError, readError });
      return summarizeUsage(await readLedger(runDir)).attempts.find(a => a.attemptId === attempt.attemptId);
    },
  };
}
