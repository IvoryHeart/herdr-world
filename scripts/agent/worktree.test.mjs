import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorktree } from './worktree.mjs';
import { git } from './lib.mjs';

async function fixture(t) {
  const primary = await mkdtemp(join(tmpdir(), 'world-worktree-'));
  const linked = join(primary, 'linked');
  t.after(async () => {
    for (const path of [linked, join(primary, '.agents/worktrees/primary-task'), join(primary, '.agents/worktrees/linked-task')]) {
      try { await access(path); git(['worktree', 'remove', '--force', path], primary); } catch { /* already removed */ }
    }
    await rm(primary, { recursive: true, force: true });
  });
  git(['init', '-b', 'main'], primary);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'Fixture'], primary);
  git(['worktree', 'add', '--no-track', '-b', 'agent/linked', linked, 'main'], primary);
  return { primary, linked };
}

test('worktrees created from primary and linked callers share the primary .agents/worktrees directory', async t => {
  const { primary, linked } = await fixture(t);
  const fromPrimary = await createWorktree('primary-task', 'main', primary);
  const fromLinked = await createWorktree('linked-task', 'main', linked);
  assert.equal(fromPrimary, join(primary, '.agents/worktrees/primary-task'));
  assert.equal(fromLinked, join(primary, '.agents/worktrees/linked-task'));
  assert.equal(git(['branch', '--show-current'], fromPrimary), 'agent/primary-task');
  assert.equal(git(['branch', '--show-current'], fromLinked), 'agent/linked-task');
});

test('worktree creation rejects unsafe slugs and unknown refs before creating a candidate', async t => {
  const { primary } = await fixture(t);
  await assert.rejects(createWorktree('../escape', 'main', primary), /lowercase task slug/);
  await assert.rejects(createWorktree('bad_slug', 'main', primary), /lowercase task slug/);
  await assert.rejects(createWorktree('missing-ref', 'missing-ref', primary), /Command failed/);
});
