import { command, repoRoot, errorExit } from './lib.mjs';
try {
  const installs = [
    ['npm', 'ci', '--prefix', 'harness'],
    [process.execPath, 'scripts/agent/skills.mjs'],
    ['npm', 'ci'],
    ['npm', 'ci', '--prefix', 'web'],
  ];
  for (const argv of installs) {
    const result = await command(argv, { cwd: repoRoot });
    if (result.code !== 0) throw new Error('Bootstrap failed: ' + argv.join(' '));
  }
  console.log('Native Codex dependencies and skills ready. Use npm run agent:doctor.');
} catch (error) { errorExit(error); }
