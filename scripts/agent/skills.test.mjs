import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, access, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleDigest, installSkills } from './skills.mjs';

async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'native-skills-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const bundle = join(cwd, '.agents/skills/superpowers');
  await mkdir(bundle, { recursive: true });
  await mkdir(join(cwd, 'harness/superpowers'), { recursive: true });
  await mkdir(join(cwd, '.codex'), { recursive: true });
  await writeFile(join(bundle, 'SKILL.md'), 'synthetic upstream skill\n');
  const release = { version: 'test', skills: ['example'], skillsSha256: await bundleDigest(bundle),
    retiredOverrideSha256: createHash('sha256').update('obsolete override').digest('hex'),
    retiredConfigSha256: createHash('sha256').update('obsolete config').digest('hex') };
  await writeFile(join(cwd, 'harness/superpowers/release.json'), JSON.stringify(release));
  await writeFile(join(cwd, 'harness/superpowers/codex.toml'), 'model = "example-model"\n');
  return { cwd, bundle };
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
  await writeFile(join(bundle, 'SKILL.md'), 'modified');
  await assert.rejects(installSkills(cwd), /differ from the pin/);
  await assert.rejects(access(join(cwd, '.codex/config.toml')), { code: 'ENOENT' });
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
