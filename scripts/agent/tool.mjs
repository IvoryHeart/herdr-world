import { join } from 'node:path';
import { command, repoRoot, errorExit } from './lib.mjs';
try {
  const [tool, ...args] = process.argv.slice(2);
  if (!['openspec', 'ralph'].includes(tool)) throw new Error('Supported tools: openspec, ralph');
  const result = await command([join(repoRoot, tool === 'ralph' ? 'harness/bin/ralph' : 'harness/node_modules/.bin/openspec'), ...args],
    { env: { ...process.env, OPENSPEC_TELEMETRY: '0', DO_NOT_TRACK: '1' } });
  process.exitCode = result.code ?? 1;
} catch (error) { errorExit(error); }
