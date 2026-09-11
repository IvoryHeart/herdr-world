// Optional provenance for native Codex work. The record is durable, but it is
// informational: native Codex and the repository's normal review process own execution.
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { git, jsonFile, errorExit } from './lib.mjs';

const taskPath = cwd => join(cwd, '.agents/state/task.json');

export async function readTask(cwd = process.cwd()) {
  try { return JSON.parse(await readFile(taskPath(cwd), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function currentBranch(cwd) {
  const branch = git(['branch', '--show-current'], cwd);
  if (!branch || branch === 'main') throw new Error('Task records require a non-main branch');
  return branch;
}

function parentReference(fields, previous) {
  return fields.parent ?? fields.base ?? previous?.parent ?? previous?.base ?? null;
}

function parentRevision(cwd, reference, fields, previous) {
  if (!reference) throw new Error('Native task records need --parent <ref> (the parent branch or commit)');
  const supplied = fields.parentRevision ?? fields.baseRevision;
  const sameReference = reference === previous?.parent || reference === previous?.base;
  if (!supplied && sameReference && (previous?.parentRevision ?? previous?.baseRevision)) {
    return previous.parentRevision ?? previous.baseRevision;
  }
  const actual = git(['rev-parse', '--verify', '--end-of-options', reference + '^{commit}'], cwd);
  if (supplied && supplied !== actual) throw new Error('The recorded parent commit does not match ' + reference);
  return actual;
}

export async function recordTask(cwd = process.cwd(), fields = {}) {
  const worktree = await realpath(cwd);
  const branch = currentBranch(cwd);
  const previous = await readTask(cwd);
  if (previous && (previous.worktree !== worktree || previous.branch !== branch)) {
    throw new Error('Task execution record belongs to a different worktree or branch');
  }
  const reference = parentReference(fields, previous);
  const revision = parentRevision(cwd, reference, fields, previous);
  const task = {
    schemaVersion: 2,
    mode: 'native',
    worktree,
    branch,
    parent: reference,
    parentRevision: revision,
    // Keep the old names for native tasks that still read the interactive record.
    base: reference,
    baseRevision: revision,
    recordedAt: new Date().toISOString(),
    ...(fields.note === undefined ? {} : { note: String(fields.note).trim() }),
    ...(fields.reason === undefined ? {} : { reason: String(fields.reason).trim() }),
  };
  await jsonFile(taskPath(cwd), task);
  return task;
}

export async function recordNative(cwd = process.cwd(), { reason = 'owner-request', note, parent, base } = {}) {
  if (!reason?.trim() || !note?.trim()) {
    throw new Error('Native task records need --reason and --note describing the authorization');
  }
  return recordTask(cwd, { reason, note, parent: parent ?? base });
}

// Existing native task instructions used `interactive`; retain it as an alias while
// the native workflow moves to the explicit `native` command.
export async function recordInteractive(cwd, reason, note, base) {
  return recordNative(cwd, { reason, note, parent: base });
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    reason: { type: 'string' }, note: { type: 'string' }, parent: { type: 'string' }, base: { type: 'string' },
  } });
  const action = positionals[0] ?? 'status';
  if (action === 'native' || action === 'interactive' || action === 'record') {
    console.log(JSON.stringify(await recordNative(process.cwd(), {
      reason: values.reason, note: values.note, parent: values.parent ?? values.base,
    }), null, 2));
    return;
  }
  if (action === 'status' || action === 'report') {
    const task = await readTask();
    if (!task) throw new Error('No native task record; use agent:task native --parent <ref> --reason <reason> --note <authorization>');
    console.log(JSON.stringify(task, null, 2));
    return;
  }
  throw new Error('Usage: agent:task native|interactive --parent <ref> --reason <reason> --note <authorization> | status');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(errorExit);
