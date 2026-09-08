import { readFile, writeFile, mkdir, mkdtemp, copyFile, chmod, rm, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = dirname(fileURLToPath(import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const transient = error => [408, 429, 500, 502, 503, 504].includes(error.status)
  || error.name === 'TimeoutError'
  || ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(error.cause?.code ?? error.code);

// Cache the pinned archive, not an unchecked executable. Verify every cache read;
// incomplete downloads never become cache entries. Retry only transport failures.
export async function releaseArchive({ url, sha256, cacheDirectory, fetcher = fetch, pause = delay }) {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid Ralph archive digest');
  await mkdir(cacheDirectory, { recursive: true });
  const cached = join(cacheDirectory, sha256 + '.tar.xz');
  try {
    const bytes = await readFile(cached);
    if (digest(bytes) === sha256) return bytes;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let archive;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) {
        await response.body?.cancel();
        throw Object.assign(new Error('Ralph download failed: HTTP ' + response.status), { status: response.status });
      }
      archive = Buffer.from(await response.arrayBuffer());
      break;
    } catch (error) {
      if (attempt === 2 || !transient(error)) throw error;
      console.error('Transient Ralph download failure; retry ' + (attempt + 1) + '/2');
      await pause(1000 * 2 ** attempt);
    }
  }
  if (digest(archive) !== sha256) throw new Error('Ralph archive checksum mismatch');
  const staging = await mkdtemp(join(cacheDirectory, '.download-'));
  try {
    await writeFile(join(staging, 'archive'), archive);
    await rename(join(staging, 'archive'), cached);
  } finally { await rm(staging, { recursive: true, force: true }); }
  return archive;
}

async function main() {
  const manifest = JSON.parse(await readFile(join(root, 'ralph-release.json'), 'utf8'));
  const release = manifest.releases[process.platform + '-' + process.arch];
  if (!release) throw new Error('Ralph harness supports Linux and macOS on x64/arm64');
  const temporary = await mkdtemp(join(root, '.install-'));
  try {
    const url = 'https://github.com/mikeyobrien/ralph-orchestrator/releases/download/v' + manifest.version + '/' + release.artifact;
    const archive = await releaseArchive({ url, sha256: release.sha256,
      cacheDirectory: join(process.env.npm_config_cache ?? join(root, '../.agents/cache/npm'), 'world-ralph') });
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
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
