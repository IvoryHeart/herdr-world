// Read-only integration check of actual native Codex discovery. No model turns.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { repoRoot, primaryCheckout } from '../scripts/agent/lib.mjs';

const release = JSON.parse(await readFile(join(repoRoot, 'harness/superpowers/release.json'), 'utf8'));
const bundle = join(repoRoot, '.agents/skills/superpowers');
async function bundleDigest(directory, relative = '') {
  const entries = await readdir(join(directory, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const path = relative ? relative + '/' + entry.name : entry.name;
    if (entry.isDirectory()) files.push(...await bundleDigest(directory, path));
    else if (entry.isFile()) files.push([path, await readFile(join(directory, path))]);
    else throw new Error('Unexpected linked entry inside upstream skills: ' + path);
  }
  return files;
}

const hash = createHash('sha256');
for (const [path, bytes] of await bundleDigest(bundle)) hash.update(path).update('\0').update(bytes).update('\0');
assert.equal(hash.digest('hex'), release.skillsSha256, 'Upstream skill files differ from the pinned bundle');
assert.equal(await readFile(join(repoRoot, 'AGENTS.override.md'), 'utf8'),
  await readFile(join(repoRoot, 'harness/superpowers/AGENTS.override.md'), 'utf8'),
  'Local trial instructions differ from the reviewed profile');

const child = spawn(join(repoRoot, 'harness/node_modules/.bin/codex'), ['--cd', repoRoot, 'app-server'], {
  cwd: repoRoot, stdio: ['pipe', 'pipe', 'pipe'],
});
const lines = createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 0;
let stderr = '';
child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
function failPending(error) {
  for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(error); }
  pending.clear();
}
child.on('error', failPending);
child.on('exit', code => failPending(new Error('Codex discovery exited: ' + code)));
lines.on('line', line => {
  let value;
  try { value = JSON.parse(line); } catch { return; }
  const waiter = pending.get(value.id);
  if (!waiter) return;
  pending.delete(value.id); clearTimeout(waiter.timer);
  if (value.error) waiter.reject(new Error(value.error.message));
  else waiter.resolve(value.result);
});
function request(method, params) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Codex discovery timed out: ' + method)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}

try {
  await request('initialize', { clientInfo: { name: 'herdr-skills-eval', version: '1' },
    capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  const primary = primaryCheckout();
  const cwds = [...new Set([repoRoot, primary])];
  const [discovery, settings] = await Promise.all([
    request('skills/list', { cwds, forceReload: true }),
    request('config/read', { cwd: repoRoot, includeLayers: true }),
  ]);
  const current = discovery.data.find(row => row.cwd === repoRoot);
  assert(current, 'No discovery result for the trial worktree');
  assert.deepEqual(current.errors, [], 'Native skill loading errors');
  const enabled = current.skills.filter(skill => skill.enabled);
  const upstreamNames = name => [name, `superpowers:${name}`];
  for (const name of release.skills) {
    const matches = enabled.filter(skill => upstreamNames(name).includes(skill.name));
    assert.equal(matches.length, 1, 'Missing or duplicated upstream skill: ' + name);
  }
  assert.equal(enabled.filter(skill => skill.name.startsWith('openspec-')).length, 6, 'OpenSpec skill visibility');
  for (const name of release.legacySkills) {
    assert(!enabled.some(skill => skill.name === name), 'Legacy workflow unexpectedly discovered: ' + name);
  }
  assert.equal(settings.config.agents?.enabled, true, 'Native agents disabled');
  assert.equal(settings.config.model, 'gpt-5.6-sol', 'Sol lead profile not loaded');
  assert.equal(settings.config.model_reasoning_effort, 'high', 'Sol lead effort profile not loaded');
  assert.equal(settings.config.agents?.max_concurrent_threads_per_session, 3, 'Native concurrency profile not loaded');
  assert.equal(settings.config.agents?.default_subagent_model, 'gpt-5.6-sol', 'Native worker model profile not loaded');
  assert.equal(settings.config.agents?.default_subagent_reasoning_effort, 'high', 'Native effort profile not loaded');
  assert.equal(settings.config.features?.goals, true, 'Native Goals profile not loaded');
  if (primary !== repoRoot) {
    const outside = discovery.data.find(row => row.cwd === primary);
    assert(outside, 'Missing primary checkout scope comparison');
    assert(!outside.skills.some(skill => skill.enabled
      && release.skills.some(name => upstreamNames(name).includes(skill.name))),
      'Trial skills leaked into the primary checkout');
  }
  console.log(JSON.stringify({ status: 'passed', scope: 'fresh-app-server-discovery',
    activeSessionVerified: false, superpowers: release.version,
    upstreamSkills: release.skills.length, openspecSkills: 6,
    legacySkillsOutsideDiscovery: release.legacySkills.length,
    primaryScopeChecked: primary !== repoRoot, modelCalls: 0 }, null, 2));
} catch (error) {
  if (stderr.includes('not trusted')) console.error('Trust the trial worktree through Codex before running this check.');
  throw error;
} finally {
  failPending(new Error('Discovery closed'));
  lines.close(); child.stdin.end(); child.kill('SIGTERM');
}
