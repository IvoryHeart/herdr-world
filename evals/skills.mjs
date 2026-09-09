// Read-only integration check of actual native Codex discovery. No model turns.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { repoRoot } from '../scripts/agent/lib.mjs';
import { bundleDigest } from '../scripts/agent/skills.mjs';

const release = JSON.parse(await readFile(join(repoRoot, 'harness/superpowers/release.json'), 'utf8'));
const bundle = join(repoRoot, '.agents/skills/superpowers');
assert.equal(await bundleDigest(bundle), release.skillsSha256,
  'Upstream skill files differ from the pinned bundle');

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
  const cwds = [repoRoot];
  const [discovery, settings] = await Promise.all([
    request('skills/list', { cwds, forceReload: true }),
    request('config/read', { cwd: repoRoot, includeLayers: true }),
  ]);
  const current = discovery.data.find(row => row.cwd === repoRoot);
  assert(current, 'No discovery result for the worktree');
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
  // Owners can deliberately override allocation. Discovery reports it; native
  // journals establish which models actually ran.
  console.log(JSON.stringify({ status: 'passed', scope: 'fresh-app-server-discovery',
    activeSessionVerified: false, superpowers: release.version,
    upstreamSkills: release.skills.length, openspecSkills: 6,
    legacySkillsOutsideDiscovery: release.legacySkills.length,
    model: settings.config.model,
    effort: settings.config.model_reasoning_effort,
    workerModel: settings.config.agents?.default_subagent_model,
    workerEffort: settings.config.agents?.default_subagent_reasoning_effort,
    concurrency: settings.config.agents?.max_concurrent_threads_per_session,
    modelCalls: 0 }, null, 2));
} catch (error) {
  if (stderr.includes('not trusted')) console.error('Trust the worktree through Codex before running this check.');
  throw error;
} finally {
  failPending(new Error('Discovery closed'));
  lines.close(); child.stdin.end(); child.kill('SIGTERM');
}
