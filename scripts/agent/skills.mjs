// Local installation only. Native Codex owns agent execution and discovery.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, realpath, symlink, unlink, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
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
  const bundle = join(cwd, '.agents/skills/superpowers');
  if (!await exists(bundle)) {
    const cache = join(primaryCheckout(cwd), '.agents/cache', 'superpowers-' + release.version);
    if (!await exists(cache)) {
      await mkdir(join(cache, '..'), { recursive: true });
      execFileSync('git', ['clone', '--depth', '1', '--branch', release.ref, release.repository, cache], { stdio: 'inherit' });
    }
    const revision = execFileSync('git', ['-C', cache, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (revision !== release.commit) throw new Error('Superpowers cache revision differs from the pin');
    if (await bundleDigest(join(cache, 'skills')) !== release.skillsSha256) throw new Error('Superpowers cache contents differ from the pin');
    await mkdir(join(cwd, '.agents/skills'), { recursive: true });
    await symlink(relative(join(cwd, '.agents/skills'), join(cache, 'skills')), bundle, 'dir');
  }
  if (await bundleDigest(bundle) !== release.skillsSha256) throw new Error('Installed Superpowers skills differ from the pin');

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
  return { superpowers: release.version, skills: release.skills.length, bundle: await realpath(bundle), config: configStatus,
    activeSessionVerified: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await installSkills(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
