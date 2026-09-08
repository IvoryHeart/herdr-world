import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { git, jsonFile, assertSourceParents } from './lib.mjs';

export const sessionGroups = {
  intake: 'lead', product: 'lead', planner: 'lead', implementer: 'lead',
  'qa-planner': 'review', reviewer: 'review', qa: 'review', oracle: 'oracle',
};
export const fullSessionGroups = { ...sessionGroups, implementer: 'builder' };
export const pairSessionGroups = { intake: 'lead', planner: 'lead', lead: 'lead', 'pair-a': 'pair-a', 'pair-b': 'pair-b', oracle: 'oracle' };
export function validateSessionGroups(groups) {
  if (groups && JSON.stringify(Object.entries(groups).sort()) === JSON.stringify(Object.entries(pairSessionGroups).sort())) return { ...groups };
  if (!groups || Object.keys(groups).length !== Object.keys(sessionGroups).length
    || Object.entries(sessionGroups).some(([role, group]) => role === 'implementer'
      ? !['lead', 'builder'].includes(groups[role]) : groups[role] !== group)) {
    throw new Error('Session groups must preserve independent review and Oracle boundaries');
  }
  return { ...groups };
}
export function contextDelta(previous, current) {
  return Object.fromEntries(Object.entries(current).filter(([key, value]) => JSON.stringify(previous?.[key]) !== JSON.stringify(value)));
}
export async function snapshotTree(runDir, workspace) {
  const index = join(runDir, 'snapshot-index-' + randomUUID());
  const env = { GIT_INDEX_FILE: index };
  try {
    git(['read-tree', 'HEAD'], workspace, env);
    git(['add', '-A', '--', '.'], workspace, env);
    return git(['write-tree'], workspace, env);
  } finally {
    await rm(index, { force: true }); await rm(index + '.lock', { force: true });
  }
}
export async function openSession(runDir, state, role) {
  const group = validateSessionGroups(state.sessionGroups ?? sessionGroups)[role];
  if (!group) throw new Error('Unknown session role');
  const directory = join(runDir, 'sessions', group);
  await assertSourceParents(runDir, 'sessions/' + group + '/home/placeholder');
  await mkdir(join(directory, 'home'), { recursive: true, mode: 0o700 });
  const path = join(directory, 'session.json');
  let saved;
  try { saved = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (saved && (saved.group !== group || saved.runId !== state.id)) throw new Error('Session belongs to another run or role group');
  const persistent = state.sessionMode !== 'fresh';
  const meta = saved ?? { group, runId: state.id, threadId: null, turns: 0, lastTree: null, context: null };
  if (meta.threadId && !/^[a-f0-9-]{36}$/.test(meta.threadId)) throw new Error('Invalid saved Codex session ID');
  // Fresh means a new history per invocation, still persisted for interrupted usage recovery.
  const home = persistent ? join(directory, 'home') : join(directory, 'attempt-' + state.activations, 'home');
  await mkdir(home, { recursive: true, mode: 0o700 });
  return { group, path, home, meta, persistent, resumed: persistent && Boolean(meta.threadId) };
}
export function saveSession(session) {
  // The thread ID must reach disk before a killed backend loses its in-memory state.
  // Metadata is outside the agent-writable home and is never mounted into a worker.
  const temporary = session.path + '.' + process.pid + '.tmp';
  writeFileSync(temporary, JSON.stringify(session.meta, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, session.path);
}
export function observeSessionLine(session, line) {
  let event;
  try { event = JSON.parse(line); } catch { return; }
  if (event.type !== 'thread.started') return;
  const id = event.thread_id;
  if (!/^[a-f0-9-]{36}$/.test(id ?? '')) { session.error = 'Codex emitted an invalid thread ID'; return; }
  if (session.resumed && id !== session.meta.threadId) { session.error = 'Codex resumed a different thread'; return; }
  session.meta.threadId = id;
  saveSession(session);
}
export async function writeDelta(runDir, workspace, session, tree, activation, baseline = 'HEAD') {
  const directory = join(runDir, 'handovers');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const previous = session.persistent && session.meta.lastTree ? session.meta.lastTree : git(['rev-parse', baseline + '^{tree}'], workspace);
  const changedPaths = git(['diff', '--name-status', previous, tree], workspace);
  const relative = 'delta-' + activation + '.patch';
  const patch = git(['diff', '--binary', previous, tree], workspace);
  await writeFile(join(directory, relative), patch ? patch + '\n' : '', { mode: 0o600 });
  return { fromTree: previous, toTree: tree, changedPaths, patch: '/handover/' + relative };
}
export async function recordHandover(runDir, state, role, response, candidate) {
  await jsonFile(join(runDir, 'handovers', 'turn-' + state.activations + '.json'), {
    schemaVersion: 1, activation: state.activations, role, candidate,
    requirementsHash: state.requirements?.hash ?? null, response,
  });
}
