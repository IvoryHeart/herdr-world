import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { primaryCheckout, errorExit } from './lib.mjs';
import { recoverUsage, readLedger } from './usage.mjs';
import { flushTelemetry } from './telemetry.mjs';

export function groupUsage(attempts, key) {
  return [...new Set(attempts.map(a => a[key] ?? 'none'))].map(value => {
    const rows = attempts.filter(a => (a[key] ?? 'none') === value);
    return { [key]: value, attempts: rows.length, elapsedMs: rows.reduce((n, a) => n + a.elapsedMs, 0),
      responses: rows.reduce((n, a) => n + a.responses, 0), timeouts: rows.filter(a => a.timedOut).length,
      missingUsage: rows.filter(a => a.coverage === 'missing' && a.role !== 'verifier').length,
      inputTokens: rows.reduce((n, a) => n + (a.usage?.input_tokens ?? 0), 0),
      cachedInputTokens: rows.reduce((n, a) => n + (a.usage?.cached_input_tokens ?? 0), 0),
      outputTokens: rows.reduce((n, a) => n + (a.usage?.output_tokens ?? 0), 0), costUsd: null };
  });
}
export function reconcileResponses(local, exported) {
  const unique = rows => new Map(rows.filter(r => r.responseId).map(r => [r.responseId, r]));
  const a = unique(local), b = unique(exported);
  const missing = [...a.keys()].filter(id => !b.has(id));
  const unexpected = [...b.keys()].filter(id => !a.has(id));
  const mismatched = [...a.keys()].filter(id => b.has(id) && Object.entries(a.get(id).usage).some(([key, n]) => Number(b.get(id).usage?.[key]) !== n));
  return { localResponses: a.size, exportedResponses: b.size, missing, unexpected, mismatched,
    status: missing.length || unexpected.length || mismatched.length ? 'mismatch' : 'matched' };
}
export async function lokiResponses(endpoint, runId, start, end) {
  const rows = [], seen = new Set(); let from = BigInt(Date.parse(start)) * 1000000n;
  const until = BigInt(Date.parse(end)) * 1000000n;
  for (let page = 0; page < 100; page++) {
    const url = new URL('/loki/api/v1/query_range', endpoint);
    url.search = new URLSearchParams({ query: '{service_name="world_agent_harness"} | runId=' + JSON.stringify(runId),
      start: String(from), end: String(until), direction: 'forward', limit: '5000' }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Loki HTTP ' + response.status);
    const data = await response.json();
    if (data.status !== 'success') throw new Error('Loki query failed');
    let count = 0, last = from;
    for (const stream of data.data.result) for (const [timestamp, body, metadata] of stream.values) {
      count++; if (BigInt(timestamp) > last) last = BigInt(timestamp);
      const fields = { ...stream.stream, ...metadata };
      if (body !== 'response.usage' || fields.runId !== runId || !fields.responseId || seen.has(fields.responseId)) continue;
      seen.add(fields.responseId);
      rows.push({ responseId: fields.responseId, usage: Object.fromEntries(['input_tokens', 'cached_input_tokens',
        'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens'].map(k => [k, Number(fields[k] ?? 0)])) });
    }
    if (count < 5000) return rows;
    // Retain the boundary timestamp; deduplication prevents replay. Refuse an ambiguous saturated page.
    if (last === from) throw new Error('Loki page saturated at one timestamp; narrow the query');
    from = last;
  }
  throw new Error('Loki pagination limit reached; report is incomplete');
}
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { loki: { type: 'string' }, 'run-dir': { type: 'string' } } });
  if (!values['run-dir'] && !/^[a-f0-9-]{36}$/.test(positionals[0] ?? '')) throw new Error('Usage: agent:metrics RUN_ID [--loki HTTP_ORIGIN]');
  const directory = values['run-dir'] ?? join(primaryCheckout(), '.agents/runs', positionals[0]);
  try { await access(join(directory, 'supervisor.lock')); throw new Error('Wait for the supervisor to stop before recovery/export'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const state = JSON.parse(await readFile(join(directory, 'run.json'), 'utf8'));
  const summary = await recoverUsage(directory);
  const exported = await flushTelemetry(directory, state.telemetry);
  const report = { runId: state.id, status: state.status, usage: summary.attempts.length ? summary.usage : null, lowerBound: summary.lowerBound,
    byModel: groupUsage(summary.attempts, 'model'), byRole: groupUsage(summary.attempts, 'role'), export: exported, costUsd: null };
  if (values.loki) {
    const local = (await readLedger(directory)).filter(r => r.type === 'response.usage');
    report.reconciliation = reconcileResponses(local, await lokiResponses(values.loki, state.id, state.startedAt, new Date().toISOString()));
    if (report.reconciliation.status !== 'matched' || !local.length) process.exitCode = 1;
  }
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(errorExit);
