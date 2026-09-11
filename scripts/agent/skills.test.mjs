import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, access, symlink, cp, readdir, lstat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleDigest, installSkills } from './skills.mjs';

async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'native-skills-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet', cwd]);
  const bundle = join(cwd, '.agents/skills/superpowers');
  const source = join(cwd, '.agents/cache/superpowers-test/skills');
  for (const name of ['example', 'excluded']) {
    await mkdir(join(source, name), { recursive: true });
    await writeFile(join(source, name, 'SKILL.md'), 'synthetic ' + name + ' skill\n');
  }
  const selection = join(cwd, '.agents/cache/selection');
  await cp(join(source, 'example'), join(selection, 'example'), { recursive: true });
  const selectedSkillsSha256 = await bundleDigest(selection);
  await rm(selection, { recursive: true });
  await mkdir(join(cwd, '.agents/skills'), { recursive: true });
  await symlink(source, bundle, 'dir');
  await mkdir(join(cwd, 'harness/superpowers'), { recursive: true });
  await mkdir(join(cwd, '.codex'), { recursive: true });
  const release = { version: 'test', skills: ['example', 'excluded'], skillsSha256: await bundleDigest(source),
    selectedSkills: ['example'], selectedSkillsSha256,
    retiredOverrideSha256: createHash('sha256').update('obsolete override').digest('hex'),
    retiredConfigSha256: createHash('sha256').update('obsolete config').digest('hex') };
  await writeFile(join(cwd, 'harness/superpowers/release.json'), JSON.stringify(release));
  await writeFile(join(cwd, 'harness/superpowers/codex.toml'), 'model = "example-model"\n');
  return { cwd, bundle, source, release };
}

test('setup preserves unrelated settings and is idempotent', async t => {
  const { cwd } = await fixture(t);
  const config = join(cwd, '.codex/config.toml');
  await writeFile(config, '# user-owned settings\n');
  assert.equal((await installSkills(cwd)).config, 'preserved');
  assert.equal((await installSkills(cwd)).activeSessionVerified, false);
  assert.equal(await readFile(config, 'utf8'), '# user-owned settings\n');
});

test('setup migrates only exact obsolete trial files', async t => {
  const { cwd } = await fixture(t);
  await writeFile(join(cwd, 'AGENTS.override.md'), 'obsolete override');
  await writeFile(join(cwd, '.codex/config.toml'), 'obsolete config');
  assert.equal((await installSkills(cwd)).config, 'migrated-trial');
  await assert.rejects(access(join(cwd, 'AGENTS.override.md')), { code: 'ENOENT' });
  assert.equal(await readFile(join(cwd, '.codex/config.toml'), 'utf8'), 'model = "example-model"\n');
});

test('custom instruction override is not removed', async t => {
  const { cwd } = await fixture(t);
  await writeFile(join(cwd, 'AGENTS.override.md'), 'owner instructions');
  await assert.rejects(installSkills(cwd), /custom AGENTS.override/);
  assert.equal(await readFile(join(cwd, 'AGENTS.override.md'), 'utf8'), 'owner instructions');
});

test('modified upstream skills fail before configuration is written', async t => {
  const { cwd, bundle } = await fixture(t);
  await writeFile(join(bundle, 'example/SKILL.md'), 'modified');
  await assert.rejects(installSkills(cwd), /differ from the pin/);
  await assert.rejects(access(join(cwd, '.codex/config.toml')), { code: 'ENOENT' });
});

test('migration exposes only selected skills without changing a shared cache or another worktree', async t => {
  const { cwd, bundle, source, release } = await fixture(t);
  const otherBundle = join(cwd, 'other-worktree-skills');
  await symlink(source, otherBundle, 'dir');
  const result = await installSkills(cwd);
  assert.equal(result.skills, 1);
  assert.deepEqual(result.selectedSkills, ['example']);
  assert.deepEqual(await readdir(bundle), ['example']);
  assert.equal((await lstat(bundle)).isSymbolicLink(), false);
  assert.equal(await bundleDigest(source), release.skillsSha256);
  assert.equal(await bundleDigest(otherBundle), release.skillsSha256);
  await writeFile(join(bundle, 'example/SKILL.md'), 'local edit');
  assert.equal(await bundleDigest(source), release.skillsSha256);
  await assert.rejects(installSkills(cwd), /differ from the pin/);
  assert.equal(await readFile(join(bundle, 'example/SKILL.md'), 'utf8'), 'local edit');
});

test('fresh setup reuses the verified cache and does not reinstall excluded skills', async t => {
  const { cwd, bundle } = await fixture(t);
  await unlink(bundle);
  assert.equal((await installSkills(cwd)).config, 'created');
  assert.deepEqual(await readdir(bundle), ['example']);
  await installSkills(cwd);
  assert.deepEqual(await readdir(bundle), ['example']);
});

test('an invalid selection digest preserves the old link and settings', async t => {
  const { cwd, bundle, source, release } = await fixture(t);
  release.selectedSkillsSha256 = 'invalid';
  await writeFile(join(cwd, 'harness/superpowers/release.json'), JSON.stringify(release));
  await assert.rejects(installSkills(cwd), /Selected Superpowers skills differ/);
  assert.equal((await lstat(bundle)).isSymbolicLink(), true);
  assert.equal(await bundleDigest(source), release.skillsSha256);
  await assert.rejects(access(join(cwd, '.codex/config.toml')), { code: 'ENOENT' });
  assert.deepEqual(await readdir(join(cwd, '.agents/cache')), ['superpowers-test']);
});

test('invalid skill names are rejected before installation', async t => {
  const { cwd, bundle, release } = await fixture(t);
  release.selectedSkills = ['../outside'];
  await writeFile(join(cwd, 'harness/superpowers/release.json'), JSON.stringify(release));
  await assert.rejects(installSkills(cwd), /Invalid Superpowers skill selection/);
  assert.equal((await lstat(bundle)).isSymbolicLink(), true);
});

test('setup does not follow a configuration directory into another workspace', async t => {
  const { cwd } = await fixture(t);
  const elsewhere = await mkdtemp(join(tmpdir(), 'native-settings-'));
  t.after(() => rm(elsewhere, { recursive: true, force: true }));
  await rm(join(cwd, '.codex'), { recursive: true });
  await symlink(elsewhere, join(cwd, '.codex'), 'dir');
  await assert.rejects(installSkills(cwd), /cannot be a symlink/);
  await assert.rejects(access(join(elsewhere, 'config.toml')), { code: 'ENOENT' });
});
