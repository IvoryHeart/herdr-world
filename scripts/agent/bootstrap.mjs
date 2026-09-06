import { command, repoRoot, errorExit } from './lib.mjs';
try {
  for (const argv of [['npm', 'ci', '--prefix', 'harness'], ['npm', 'ci'], ['npm', 'ci', '--prefix', 'web']]) {
    const result = await command(argv, { cwd: repoRoot });
    if (result.code !== 0) throw new Error('Bootstrap failed: ' + argv.join(' '));
  }
  console.log('Dependencies ready. Use npm run agent:doctor; Docker image setup is documented in docs/agent-development.md.');
} catch (error) { errorExit(error); }
