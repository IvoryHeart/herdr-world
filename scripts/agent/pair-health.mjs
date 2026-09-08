import { statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadState, saveState } from './run-state.mjs';
import { command } from './lib.mjs';
import { recordEvent } from './usage.mjs';
export function diskHealth(stats) {
  const availableBytes = stats.bavail * stats.bsize;
  const availableInodes = stats.ffree;
  return { availableBytes, availableInodes,
    level: availableBytes < 2 * 1024 ** 3 || (stats.files > 0 && availableInodes < 1000) ? 'critical'
      : availableBytes < 10 * 1024 ** 3 || (stats.files > 0 && availableInodes < 10000) ? 'warning' : 'ok' };
}
export async function inspectHealth(runDir) {
  const state = await loadState(runDir);
  if (state.workflow !== 'pair') return;
  const disks = await Promise.all([join(runDir, 'workspace'), runDir, '/tmp'].map(async path => ({ path, ...diskHealth(await statfs(path)) })));
  state.health = { inspectedAt: new Date().toISOString(), disks };
  const critical = disks.some(d => d.level === 'critical');
  for (const [index, disk] of disks.entries()) recordEvent(runDir, 'health.disk', { runId: state.id,
    diskKind: ['workspace', 'control', 'temporary'][index], level: disk.level, availableBytes: disk.availableBytes, availableInodes: disk.availableInodes });
  if (disks.some(d => d.level !== 'ok')) recordEvent(runDir, 'health.warning', { runId: state.id, disks });
  if (critical) { state.status = 'blocked'; state.reason = 'Disk or inode reserve is critically low. Free owned disposable outputs, then resume this run. Preserved work and evidence have not been deleted.'; }
  await saveState(runDir, state);
  if (critical) throw new Error(state.reason);
}
export async function measureStorage(runDir, worktree, phase) {
  const result = await command(['du', '-sk', '--', worktree, runDir], { stream: false, timeoutMs: 15000 });
  const sizes = result.code === 0 ? result.output.trim().split('\n').map(row => Number(row.split(/\s/)[0]) * 1024) : [];
  recordEvent(runDir, 'storage.measured', { runId: (await loadState(runDir)).id, phase, workspaceBytes: sizes[0] ?? null, runBytes: sizes[1] ?? null });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) inspectHealth(process.env.WORLD_AGENT_RUN).catch(error => { console.error(error.message); process.exitCode = 1; });
