// Local installation only. Native Codex owns agent execution and discovery.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { primaryCheckout, repoRoot } from './lib.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function bundleDigest(directory) {
  const hash = createHash('sha256');
  async function visit(subpath = '') {
    const entries = await readdir(join(directory, subpath), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = subpath ? subpath + '/' + entry.name : entry.name;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) hash.update(path).update('\0').update(await readFile(join(directory, path))).update('\0');
      else throw new Error('Unexpected linked entry inside upstream skills: ' + path);
    }
  }
  await visit();
  return hash.digest('hex');
}

async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function installSkills(cwd = repoRoot) {
  for (const part of ['.agents', '.agents/skills', '.codex']) {
    const path = join(cwd, part);
    if (await exists(path) && (await lstat(path)).isSymbolicLink()) {
      throw new Error('Local setup directory cannot be a symlink: ' + part);
    }
  }
  const release = JSON.parse(await readFile(join(cwd, 'harness/superpowers/release.json'), 'utf8'));
  if (!Array.isArray(release.selectedSkills) || !release.selectedSkills.length ||
      new Set(release.selectedSkills).size !== release.selectedSkills.length ||
      release.selectedSkills.some(name => !/^[a-z0-9-]+$/.test(name) || !release.skills.includes(name))) {
    throw new Error('Invalid Superpowers skill selection');
  }
  const bundle = join(cwd, '.agents/skills/superpowers');
  let source;
  if (await exists(bundle)) {
    const digest = await bundleDigest(bundle);
    if (digest !== release.selectedSkillsSha256) {
      // Migrate only the verified old full-bundle link; never edit its shared target.
      if (!(await lstat(bundle)).isSymbolicLink() || digest !== release.skillsSha256) {
        throw new Error('Installed Superpowers skills differ from the pin');
      }
      source = await realpath(bundle);
    }
  } else {
    const cache = join(primaryCheckout(cwd), '.agents/cache', 'superpowers-' + release.version);
    if (!await exists(cache)) {
      await mkdir(join(cache, '..'), { recursive: true });
      execFileSync('git', ['clone', '--depth', '1', '--branch', release.ref, release.repository, cache], { stdio: 'inherit' });
      const revision = execFileSync('git', ['-C', cache, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      if (revision !== release.commit) throw new Error('Superpowers cache revision differs from the pin');
    }
    source = join(cache, 'skills');
  }
  if (source) {
    if (await bundleDigest(source) !== release.skillsSha256) throw new Error('Superpowers cache contents differ from the pin');
    // Stage outside skill discovery and validate before replacing any existing link.
    await mkdir(join(cwd, '.agents/cache'), { recursive: true });
    const stage = await mkdtemp(join(cwd, '.agents/cache', 'selected-skills-'));
    try {
      for (const name of release.selectedSkills) await cp(join(source, name), join(stage, name), { recursive: true });
      if (await bundleDigest(stage) !== release.selectedSkillsSha256) throw new Error('Selected Superpowers skills differ from the pin');
      await mkdir(join(cwd, '.agents/skills'), { recursive: true });
      if (await exists(bundle)) await unlink(bundle);
      await rename(stage, bundle);
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }
  if (await bundleDigest(bundle) !== release.selectedSkillsSha256) throw new Error('Installed Superpowers skills differ from the pin');

  // Remove only the byte-identical obsolete trial override; preserve user instructions.
  const override = join(cwd, 'AGENTS.override.md');
  if (await exists(override)) {
    if (sha256(await readFile(override)) === release.retiredOverrideSha256) await unlink(override);
    else throw new Error('A custom AGENTS.override.md exists; reconcile it with AGENTS.md before native setup');
  }
  await mkdir(join(cwd, '.codex'), { recursive: true });
  const config = join(cwd, '.codex/config.toml');
  const template = await readFile(join(cwd, 'harness/superpowers/codex.toml'));
  let configStatus = 'preserved';
  if (!await exists(config)) {
    await writeFile(config, template, { flag: 'wx', mode: 0o600 });
    configStatus = 'created';
  } else if (!(await lstat(config)).isSymbolicLink() && sha256(await readFile(config)) === release.retiredConfigSha256) {
    await writeFile(config, template, { mode: 0o600 });
    configStatus = 'migrated-trial';
  }
  return { superpowers: release.version, skills: release.selectedSkills.length, selectedSkills: release.selectedSkills,
    bundle: await realpath(bundle), config: configStatus,
    activeSessionVerified: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await installSkills(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
