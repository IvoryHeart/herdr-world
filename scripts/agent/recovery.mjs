import { access, cp, mkdir, open, readFile, realpath, unlink } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { command, git, jsonFile, primaryCheckout } from './lib.mjs';
import { loadState } from './run-state.mjs';

export async function claimWorktree(worktree, runId) {
  const root = await realpath(worktree);
  const directory = join(primaryCheckout(root), '.agents/state/worktree-locks');
  await mkdir(directory, { recursive: true });
  const path = join(directory, createHash('sha256').update(root).digest('hex') + '.lock');
  const lock = await open(path, 'wx').catch(error => { if (error.code === 'EEXIST') throw new Error('This task worktree already has a supervisor lock: ' + path + '. Check its PID before removing a stale lock.'); throw error; });
  await lock.writeFile(JSON.stringify({ pid: process.pid, runId, worktree: root }));
  await lock.close();
  return () => unlink(path);
}
export async function recoverySource(runBase, id, cwd) {
  if (!/^[a-f0-9-]{36}$/.test(id ?? '')) throw new Error('Supply the stopped run ID');
  const directory = join(runBase, id), state = await loadState(directory);
  if (!['interrupted', 'failed', 'blocked', 'exhausted'].includes(state.status)) throw new Error('Recover only a stopped unsuccessful run');
  if (await realpath(state.delivery.worktree) !== await realpath(cwd)) throw new Error('Recover from the original task worktree after incorporating the updated harness');
  try { await access(join(directory, 'supervisor.lock')); throw new Error('Old supervisor lock remains; establish that it is stopped before recovery'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const active = await command(['docker', 'ps', '--filter', 'name=world-agent-' + id + '-', '--format', '{{.Names}}'], { stream: false, timeoutMs: 15000 });
  if (active.code !== 0 || active.output.trim()) throw new Error('Could not establish that the old run has no active containers');
  git(['merge-base', '--is-ancestor', state.sourceRevision, 'HEAD'], cwd);
  return { directory, state };
}
export async function carryRecovery(old, runDir, state) {
  const workspace = join(runDir, 'workspace');
  let patch = '';
  try { patch = await readFile(join(old.directory, 'candidate.patch'), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (old.state.workflow !== 'pair') {
    // A legacy candidate lives in an isolated repository. Import its unapplied diff
    // only after a dry run; never reset, overwrite a conflict, or edit old evidence.
    if (patch.trim()) {
      const checked = await command(['git', 'apply', '--check', '--binary', '-'], { cwd: workspace, input: patch, stream: false });
      if (checked.code !== 0) {
        const applied = await command(['git', 'apply', '--reverse', '--check', '--binary', '-'], { cwd: workspace, input: patch, stream: false });
        if (applied.code !== 0) throw new Error('Retained candidate.patch conflicts with the task worktree; reconcile it explicitly before recovery');
      } else {
        const result = await command(['git', 'apply', '--binary', '-'], { cwd: workspace, input: patch, stream: false });
        if (result.code !== 0) throw new Error('Could not import retained candidate.patch: ' + result.output);
      }
    }
  }
  state.requirements = old.state.requirements; state.plan = old.state.plan;
  state.specialists = old.state.specialists ?? [];
  state.oracle = { consultations: old.state.oracle?.consultations ?? 0, lastAdvice: old.state.oracle?.lastAdvice ?? null };
  state.recovery = { fromRunId: old.state.id, sourceRevision: old.state.sourceRevision,
    previousWorkflow: old.state.workflow, previousRemainingMs: old.state.remainingMs,
    authorizedModelMs: state.remainingMs, retainedHistories: [], lineage: [...(old.state.recovery?.lineage ?? []), old.state.id],
    note: 'Updated controls; prior receipts are historical, not current acceptance. Review the full task delta against reviewBase, including committed work. Native histories were retained where available.' };
  const mapping = old.state.workflow === 'pair'
    ? { lead: 'lead', 'pair-a': 'pair-a', 'pair-b': 'pair-b', oracle: 'oracle' }
    : { lead: 'pair-a', review: 'pair-b', oracle: 'oracle' };
  for (const [from, to] of Object.entries(old.state.sessionMode === 'fresh' ? {} : mapping)) {
    const source = join(old.directory, 'sessions', from), target = join(runDir, 'sessions', to);
    let meta;
    try { meta = JSON.parse(await readFile(join(source, 'session.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!meta.threadId) continue;
    try { await access(join(source, 'home')); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    await mkdir(target, { recursive: true });
    await cp(join(source, 'home'), join(target, 'home'), { recursive: true, mode: constants.COPYFILE_FICLONE,
      filter: path => !['auth.json', 'tmp', 'thread-writer-locks', 'shell_snapshots'].includes(basename(path)) });
    state.recovery.retainedHistories.push(to);
    await jsonFile(join(target, 'session.json'), { ...meta, group: to, runId: state.id, context: null, lastTree: null, status: 'idle', migratedFrom: old.state.id });
  }
  if (old.state.referenceImages?.length) {
    await cp(join(old.directory, 'control/references'), join(runDir, 'control/references'), { recursive: true });
    state.referenceImages = old.state.referenceImages;
  }
  state.intake = state.requirements ? null : old.state.intake;
  state.pair = {};
  state.lastEvent = state.requirements ? 'pair.a' : 'plan.start';
}
