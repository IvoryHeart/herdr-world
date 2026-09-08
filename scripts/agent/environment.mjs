import { cp, mkdir, lstat, readlink, access, readFile, realpath } from 'node:fs/promises';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { recordEvent } from './usage.mjs';
import { createHash } from 'node:crypto';
import { command, sourceFiles, git, assertSourceParents } from './lib.mjs';

export async function copyCandidate(source, target, { exclude = [] } = {}) {
  await mkdir(target, { recursive: true });
  for (const file of await sourceFiles(source)) {
    if (exclude.some(prefix => file.startsWith(prefix))) continue;
    await assertSourceParents(source, file);
    const full = join(source, file);
    let stat;
    try { stat = await lstat(full); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (stat.isSymbolicLink()) {
      const link = await readlink(full);
      const rel = relative(source, resolve(dirname(full), link));
      if (isAbsolute(link) || rel.startsWith('..')) throw new Error('Candidate symlink escapes workspace: ' + file);
    }
    await mkdir(dirname(join(target, file)), { recursive: true });
    await cp(full, join(target, file), { dereference: false, verbatimSymlinks: true });
  }
  git(['init', '-b', 'candidate'], target);
  git(['add', '.'], target);
  git(['-c', 'user.name=Agent fixture', '-c', 'user.email=agent@example.invalid', 'commit', '-qm', 'Candidate baseline'], target);
}
export function dockerArgs(state, workspace, { readOnly = false, network = 'none', authFile, control, name, sessionHome, handovers } = {}) {
  const codexHome = sessionHome ? '/agent-home' : '/tmp/world-codex';
  const args = ['docker', 'run', '--rm', '--init', '-i', '--name', name, '--user', String(process.getuid?.() ?? 1000) + ':' + String(process.getgid?.() ?? 1000),
    '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=512', '--memory=6g', '--cpus=4',
    '--network', network, '--read-only', '--tmpfs', '/tmp:rw,exec,size=2g',
    '--tmpfs', '/tmp/world-codex:rw,mode=1777,size=64m',
    '--mount', 'type=bind,src=' + workspace + ',dst=/workspace' + (readOnly ? ',readonly' : ''),
    '--mount', 'type=bind,src=' + join(workspace, '.git') + ',dst=/workspace/.git,readonly',
    '--mount', 'type=bind,src=' + control + ',dst=/control,readonly',
    '--workdir', '/workspace', '-e', 'OPENSPEC_TELEMETRY=0', '-e', 'DO_NOT_TRACK=1',
    '-e', 'CODEX_HOME=' + codexHome, '-e', 'npm_config_cache=/workspace/.agents/cache/npm',
    '-e', 'CARGO_HOME=/workspace/.agents/cache/cargo', '-e', 'PLAYWRIGHT_BROWSERS_PATH=/workspace/.agents/cache/browsers'];
  if (state.workflow === 'pair' && state.gitCommonDir) args.push('--mount',
    'type=bind,src=' + state.gitCommonDir + ',dst=' + state.gitCommonDir + ',readonly',
    '-e', 'GIT_CONFIG_NOSYSTEM=1', '-e', 'GIT_CONFIG_GLOBAL=/dev/null',
    '-e', 'GIT_CONFIG_COUNT=1', '-e', 'GIT_CONFIG_KEY_0=safe.directory', '-e', 'GIT_CONFIG_VALUE_0=/workspace');
  if (sessionHome) args.push('--mount', 'type=bind,src=' + sessionHome + ',dst=' + codexHome);
  if (authFile && state.telemetry?.hostGateway && process.platform === 'linux') args.push('--add-host', 'host.docker.internal:host-gateway');
  if (handovers) args.push('--mount', 'type=bind,src=' + handovers + ',dst=/handover,readonly');
  if (authFile) args.push(
    '--mount', 'type=bind,src=' + authFile + ',dst=' + codexHome + '/auth.json,readonly',
    '--mount', 'type=bind,src=' + join(workspace, '.ralph') + ',dst=/workspace/.ralph,readonly');
  args.push(state.image);
  return args;
}
export async function inContainer(state, workspace, argv, options = {}) {
  if (state.environment === 'harbor') {
    // This driver is only used inside a Harbor-owned container. The local runner
    // never selects it; external grading remains in a separate environment.
    await access('/.dockerenv');
    await access('/logs/agent');
    const modelCall = argv[0].endsWith('/codex');
    const args = [...argv];
    if (modelCall && options.readOnly) {
      const configured = args.findIndex(arg => arg.startsWith('sandbox_mode='));
      if (configured >= 0) args[configured] = 'sandbox_mode="read-only"';
      else args[args.indexOf('--sandbox') + 1] = 'read-only';
    }
    const env = { PATH: process.env.PATH, RUSTUP_HOME: process.env.RUSTUP_HOME,
      CARGO_HOME: join(workspace, '.agents/cache/cargo'), npm_config_cache: '/tmp/world-npm',
      OPENSPEC_TELEMETRY: '0', DO_NOT_TRACK: '1' };
    if (modelCall) { env.CODEX_API_KEY = process.env.CODEX_API_KEY; env.CODEX_HOME = options.sessionHome ?? '/tmp/world-codex'; }
    return command(args, { ...options, cwd: workspace, env });
  }
  workspace = await realpath(workspace);
  const name = 'world-agent-' + state.id + '-' + (options.instanceId ?? Date.now());
  try {
    return await command([...dockerArgs(state, workspace, { ...options, name }), ...argv], options);
  } finally {
    // A killed docker client can leave its container alive. Remove only this invocation's name.
    await command(['docker', 'rm', '-f', name], { stream: false, timeoutMs: 15000 }).catch(() => {});
  }
}
export async function prepareDependencies(state, workspace, control, { timeoutMs = 1200000 } = {}) {
  let key;
  if (state.workflow === 'pair') {
    const hash = createHash('sha256').update(state.image + state.profile);
    for (const file of ['package-lock.json', 'web/package-lock.json', 'harness/package-lock.json', 'bridge/Cargo.lock', 'vendor/herdr-compat/Cargo.lock']) hash.update(await readFile(join(workspace, file)));
    key = hash.digest('hex');
    const required = ['.agents/cache/cargo', ...(state.profile === 'acceptance' ? ['.agents/cache/browsers'] : [])];
    for (const prefix of ['', 'web', 'harness']) {
      const pkg = JSON.parse(await readFile(join(workspace, prefix, 'package.json')));
      if (Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length) required.push(join(prefix, 'node_modules'));
    }
    const installed = await Promise.all(required.map(path => access(join(workspace, path)).then(() => true, () => false)));
    if (state.preparation?.key === key && installed.every(Boolean)) return { code: 0, elapsedMs: 0, reused: true, output: '' };
  }
  await mkdir(join(workspace, '.agents/cache/cargo'), { recursive: true });
  if (key) recordEvent(dirname(control), 'preparation.started', { runId: state.id });
  const result = await inContainer(state, workspace, ['bash', '-c',
    'npm ci && npm ci --prefix web && npm ci --prefix harness && cargo fetch --locked --manifest-path bridge/Cargo.toml && cargo fetch --locked --manifest-path vendor/herdr-compat/Cargo.toml' +
    (state.profile === 'acceptance' ? ' && npx --no-install playwright install chromium' : '')],
  { control, network: 'bridge', stream: false, timeoutMs, log: join(control, '../bootstrap.log') });
  if (key) recordEvent(dirname(control), 'preparation.finished', { runId: state.id, code: result.code, elapsedMs: result.elapsedMs });
  if (key && result.code === 0) state.preparation = { key, elapsedMs: result.elapsedMs, finishedAt: new Date().toISOString() };
  return result;
}
