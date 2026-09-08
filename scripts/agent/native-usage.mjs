// Post-run accounting from native journals. No model, runtime or credentials.
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { normalizeUsage } from './usage.mjs';

const fields = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens'];
const zero = () => Object.fromEntries(fields.map(key => [key, 0]));
function add(target, usage) { for (const key of fields) target[key] += usage[key] ?? 0; }
async function filesIn(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(path));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path);
  }
  return files.sort();
}
async function firstRecord(path) {
  // Session metadata is small; avoid reading unrelated transcripts or image blobs.
  const input = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const row = JSON.parse(line);
      return row.type === 'session_meta' ? row.payload : null;
    }
    return null;
  } finally { lines.close(); input.destroy(); }
}
function parentOf(meta) {
  return meta.source?.subagent?.thread_spawn?.parent_thread_id ?? null;
}
function roleOf(meta) {
  return meta.source?.subagent?.thread_spawn?.agent_path ?? 'lead';
}

export async function summarizeNativeUsage({ sessions, thread, since, until = new Date().toISOString() }) {
  if (!thread || typeof thread !== 'string') throw new Error('A native lead thread ID is required');
  const start = since === undefined ? -Infinity : Date.parse(since);
  const end = Date.parse(until);
  if ((since !== undefined && !Number.isFinite(start)) || !Number.isFinite(end) || start > end) {
    throw new Error('Use valid ordered ISO timestamps for --since/--until');
  }
  const index = new Map(), warnings = [];
  for (const path of await filesIn(sessions)) {
    try {
      const meta = await firstRecord(path);
      if (!meta?.id) continue;
      const entry = index.get(meta.id) ?? { meta, files: [] };
      entry.files.push(path); index.set(meta.id, entry);
    } catch (error) {
      // A corrupt header cannot safely be assigned to or excluded from this family.
      warnings.push('Unreadable session header; family coverage may be incomplete (' + error.name + ')');
    }
  }
  if (!index.has(thread)) throw new Error('Lead thread was not found in native session storage');
  const family = new Set([thread]);
  let changed;
  do {
    changed = false;
    for (const [id, entry] of index) if (!family.has(id) && family.has(parentOf(entry.meta))) {
      family.add(id); changed = true;
    }
  } while (changed);

  const responses = new Map(), agents = [], expectedChildren = new Set();
  for (const id of family) {
    const entry = index.get(id), records = [];
    for (const path of entry.files) {
      const input = createReadStream(path, { encoding: 'utf8' });
      const lines = createInterface({ input, crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          if (!line.trim()) continue;
          try {
            const row = JSON.parse(line);
            if (['turn_context', 'token_usage_record', 'event_msg', 'response_item'].includes(row.type)) records.push(row);
          } catch { warnings.push('Malformed record in thread ' + id + '; usage may be incomplete'); }
        }
      } finally { lines.close(); input.destroy(); }
    }
    records.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    let model = null, effort = null, pendingSpawn = new Set();
    const activeChildren = new Set();
    const turns = new Map(), models = new Set(), efforts = new Set();
    let lastUsage = null, firstUsage = null, started = false, interrupted = false;
    for (const row of records) {
      const p = row.payload ?? {}, at = Date.parse(row.timestamp);
      if (!Number.isFinite(at) || at > end) continue;
      if (row.type === 'turn_context') { model = p.model ?? null; effort = p.effort ?? p.reasoning_effort ?? null; }
      if (row.type === 'event_msg' && p.type === 'task_started') {
        const turnId = p.turn_id ?? row.timestamp;
        turns.set(turnId, { id: turnId, start: at, end: null }); started = true;
      }
      if (row.type === 'event_msg' && ['task_complete', 'turn_aborted'].includes(p.type)) {
        const turn = turns.get(p.turn_id) ?? [...turns.values()].findLast(value => value.end === null);
        if (turn) turn.end = at;
        if (p.type === 'turn_aborted' && at >= start) interrupted = true;
      }
      if (row.type === 'event_msg' && p.item?.type === 'SubAgentActivity'
        && typeof p.item.agent_thread_id === 'string') {
        const child = p.item.agent_thread_id;
        if (['started', 'interacted'].includes(p.item.kind)) activeChildren.add(child);
        if (at >= start) expectedChildren.add(child);
        if (p.item.kind === 'completed') activeChildren.delete(child);
      }
      if (at < start) continue;
      if (row.type === 'response_item' && p.type === 'function_call' && p.name === 'spawn_agent') pendingSpawn.add(p.call_id);
      if (row.type === 'response_item' && p.type === 'function_call_output' && pendingSpawn.has(p.call_id)) {
        pendingSpawn.delete(p.call_id);
        try {
          const result = typeof p.output === 'string' ? JSON.parse(p.output) : p.output;
          const child = result?.agent_id ?? result?.agentId;
          if (typeof child === 'string') expectedChildren.add(child);
        } catch { /* Metadata ancestry remains authoritative when output is not JSON. */ }
      }
      if (row.type !== 'token_usage_record' || p.thread_id !== id) continue;
      const usage = normalizeUsage(p.usage);
      if (!usage || typeof p.response_id !== 'string') { warnings.push('Invalid usage record in thread ' + id); continue; }
      const value = { thread: id, turn: p.turn_id ?? null, model: model ?? 'unknown', effort: effort ?? 'unknown', usage, at };
      const previous = responses.get(p.response_id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(value)) {
        warnings.push('Conflicting duplicate response ' + p.response_id);
        continue;
      }
      responses.set(p.response_id, value);
      models.add(value.model); efforts.add(value.effort);
      firstUsage = firstUsage === null ? at : Math.min(firstUsage, at);
      lastUsage = lastUsage === null ? at : Math.max(lastUsage, at);
    }
    for (const child of activeChildren) expectedChildren.add(child);
    const selectedTurns = [...turns.values()].filter(t => t.start <= end && (t.end ?? end) >= start);
    if (!selectedTurns.length && firstUsage === null && start !== -Infinity) continue;
    const measuredTurns = new Set([...responses.values()].filter(r => r.thread === id).map(r => r.turn));
    for (const turn of selectedTurns) if (!measuredTurns.has(turn.id)) {
      warnings.push('No measured responses for selected turn ' + turn.id + ' in thread ' + id);
    }
    if (measuredTurns.has(null) || [...measuredTurns].some(turn => !turns.has(turn))) {
      warnings.push('Usage without a matching task interval in thread ' + id);
    }
    const active = selectedTurns.some(t => t.end === null);
    agents.push({
      thread: id, parent: parentOf(entry.meta), role: roleOf(entry.meta),
      models: [...models], efforts: [...efforts], turns: selectedTurns.length,
      activeSeconds: selectedTurns.reduce((n, t) => n + (Math.min(t.end ?? end, end) - Math.max(t.start, start)) / 1000, 0),
      elapsedSeconds: selectedTurns.length ? (Math.min(Math.max(...selectedTurns.map(t => t.end ?? end)), end)
        - Math.max(Math.min(...selectedTurns.map(t => t.start)), start)) / 1000 : null,
      status: active ? 'running-at-cutoff' : interrupted ? 'interrupted' : !started ? 'unknown' : 'completed',
      firstUsageAt: firstUsage === null ? null : new Date(firstUsage).toISOString(),
      lastUsageAt: lastUsage === null ? null : new Date(lastUsage).toISOString(),
      responses: 0, usage: zero(),
    });
  }
  for (const child of expectedChildren) if (!family.has(child)) warnings.push('Spawned child history is missing: ' + child);
  const totals = zero(), byModel = {};
  for (const response of responses.values()) {
    add(totals, response.usage);
    const key = response.model + '/' + response.effort;
    const group = byModel[key] ??= { responses: 0, usage: zero() };
    group.responses++; add(group.usage, response.usage);
    const agent = agents.find(a => a.thread === response.thread);
    agent.responses++; add(agent.usage, response.usage);
  }
  for (const agent of agents) if (!agent.responses) warnings.push('No measured responses in the selected interval for ' + agent.thread);
  if (Object.keys(byModel).some(key => key.startsWith('unknown/'))) warnings.push('Some response model allocation is unknown');
  return {
    schemaVersion: 1, workflow: 'native-codex', leadThread: thread,
    observedAt: new Date().toISOString(), since: since ?? null, until,
    coverage: warnings.length || agents.some(a => a.status !== 'completed') ? 'provisional' : 'recorded-completed-responses',
    responses: responses.size, usage: totals, byModel, agents, warnings: [...new Set(warnings)], costUsd: null,
    notes: [
      'Includes the selected lead and descendants identified by native parent metadata; other sessions are excluded.',
      'Cached input is included in input; reasoning output is included in output.',
      'Active thread intervals include command/wait time and may overlap; do not add them as wall time.',
      'Unreported responses and histories absent from storage cannot be reconstructed. This is not an invoice.',
      'A report generated within its own active thread excludes that thread’s later responses; refresh after completion.',
    ],
  };
}

async function main() {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i]?.replace(/^--/, '');
    if (!['thread', 'sessions', 'since', 'until', 'output'].includes(key) || !process.argv[i + 1]) {
      throw new Error('Usage: agent:usage -- --thread ID [--sessions DIR] [--since ISO] [--until ISO] [--output FILE]');
    }
    options[key] = process.argv[i + 1];
  }
  options.thread ??= process.env.CODEX_THREAD_ID;
  options.sessions ??= join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');
  const report = await summarizeNativeUsage(options);
  if (options.output) {
    const output = resolve(options.output);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  }
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
