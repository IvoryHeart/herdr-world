import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { jsonFile } from './lib.mjs';
import { readLedger } from './usage.mjs';

export async function localTelemetryEndpoint(primary) {
  try { return JSON.parse(await readFile(join(primary, '.agents/state/telemetry.json'), 'utf8')).endpoint; }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

export function telemetryConfig(endpoint) {
  if (!endpoint) return null;
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('OTEL endpoint must be an HTTP(S) origin without credentials or a path');
  }
  const worker = new URL(url);
  const hostGateway = ['localhost', '127.0.0.1', '[::1]'].includes(worker.hostname);
  if (hostGateway) worker.hostname = 'host.docker.internal';
  return { endpoint: url.origin, workerEndpoint: worker.origin, hostGateway };
}
export function telemetryArguments(config) {
  return ['-c', 'otel.log_user_prompt=false', '-c', 'otel.exporter="none"', '-c', 'otel.trace_exporter="none"',
    '-c', 'otel.metrics_exporter=' + (config ? '{ otlp-http = { endpoint = ' + JSON.stringify(config.workerEndpoint + '/v1/metrics') + ', protocol = "binary" } }' : '"none"')];
}
const safeFields = ['eventId', 'runId', 'attemptId', 'instanceId', 'activation', 'role', 'sessionGroup', 'model', 'reasoningEffort',
  'sessionId', 'turnId', 'responseId', 'stage', 'code', 'timedOut', 'interrupted', 'recovered', 'resumed', 'status'];
export function otlpLogs(rows) {
  const value = v => typeof v === 'boolean' ? { boolValue: v } : typeof v === 'number' ? { intValue: String(v) } : { stringValue: String(v) };
  return { resourceLogs: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: 'world_agent_harness' } }] },
    scopeLogs: [{ scope: { name: 'herdr-world-harness', version: '1' }, logRecords: rows.map(row => ({
      timeUnixNano: String(BigInt(Date.parse(row.timestamp)) * 1000000n), body: { stringValue: row.type },
      attributes: [...safeFields.filter(key => row[key] !== undefined && row[key] !== null).map(key => ({ key, value: value(row[key]) })),
        ...Object.entries(row.usage ?? {}).map(([key, n]) => ({ key, value: value(n) }))],
    })) }] }] };
}
export async function flushTelemetry(runDir, config) {
  if (!config) return { status: 'disabled' };
  let cursor = { sent: 0 };
  const path = join(runDir, 'telemetry-export.json');
  try { cursor = JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const rows = await readLedger(runDir);
  try {
    while (cursor.sent < rows.length) {
      const batch = rows.slice(cursor.sent, cursor.sent + 200);
      const result = await fetch(config.endpoint + '/v1/logs', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(otlpLogs(batch)), signal: AbortSignal.timeout(3000) });
      if (!result.ok) throw new Error('OTLP HTTP ' + result.status);
      const response = await result.json();
      if (Number(response.partialSuccess?.rejectedLogRecords ?? 0)) throw new Error('Collector rejected some usage records');
      cursor = { sent: cursor.sent + batch.length, status: 'exported' }; await jsonFile(path, cursor);
    }
  } catch (error) { cursor = { ...cursor, status: 'pending', error: error.message }; await jsonFile(path, cursor); }
  // Retries are at-least-once; use eventId/responseId to deduplicate at the receiver.
  return cursor;
}
