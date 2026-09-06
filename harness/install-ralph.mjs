import { readFile, writeFile, mkdir, mkdtemp, copyFile, chmod, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'ralph-release.json'), 'utf8'));
const release = manifest.releases[process.platform + '-' + process.arch];
if (!release) throw new Error('Ralph harness supports Linux and macOS on x64/arm64');
const temporary = await mkdtemp(join(root, '.install-'));
try {
  const url = 'https://github.com/mikeyobrien/ralph-orchestrator/releases/download/v' + manifest.version + '/' + release.artifact;
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error('Ralph download failed: HTTP ' + response.status);
  const archive = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(archive).digest('hex') !== release.sha256) throw new Error('Ralph archive checksum mismatch');
  const path = join(temporary, 'release.tar.xz');
  await writeFile(path, archive);
  const member = release.artifact.replace(/\.tar\.xz$/, '') + '/ralph';
  const license = release.artifact.replace(/\.tar\.xz$/, '') + '/LICENSE';
  execFileSync('tar', ['-xf', path, '-C', temporary, member, license]);
  await mkdir(join(root, 'bin'), { recursive: true });
  await copyFile(join(temporary, member), join(root, 'bin/ralph'));
  await copyFile(join(temporary, license), join(root, 'bin/Ralph-LICENSE'));
  await chmod(join(root, 'bin/ralph'), 0o755);
  console.log(execFileSync(join(root, 'bin/ralph'), ['--version'], { encoding: 'utf8' }).trim());
} finally {
  await rm(temporary, { recursive: true, force: true });
}
