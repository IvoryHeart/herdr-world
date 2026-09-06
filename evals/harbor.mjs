import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { command, repoRoot, errorExit } from '../scripts/agent/lib.mjs';
try {
  const args = process.argv.slice(2);
  if (!args.length) throw new Error('Usage: npm run eval:harbor -- run -p PREPARED_TASKS -a oracle|nop|codex|evals.adapters.ralph:WorldRalph ...');
  if (args[0] === 'run' && !args.includes('-a') && !args.includes('--agent')) throw new Error('Choose an explicit agent; no implicit live model runs');
  const temporary = join(repoRoot, '.agents/state/harbor-tmp');
  await mkdir(temporary, { recursive: true, mode: 0o700 });
  const result = await command(['uv', 'run', '--project', join(repoRoot,'evals'), 'harbor', ...args],
    { cwd: repoRoot, env: { ...process.env, TMPDIR: temporary }, timeoutMs: 3600000 });
  process.exitCode = result.code ?? 1;
} catch (error) { errorExit(error); }
