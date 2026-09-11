import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { command, repoRoot, primaryCheckout, git, errorExit } from './lib.mjs';

try {
  const pins = JSON.parse(await readFile(join(repoRoot, 'harness/tool-versions.json')));
  const checks = [
    ['node', ['node', '--version']],
    ['rust', ['rustc', '--version']],
    ['cargo-about', ['cargo-about', '--version']],
    ['openspec', [join(repoRoot, 'harness/node_modules/.bin/openspec'), '--version']],
    ['codex', [join(repoRoot, 'harness/node_modules/.bin/codex'), '--version']],
  ];
  let failed = false;
  for (const [name, argv] of checks) {
    try {
      const result = await command(argv, { cwd: repoRoot, stream: false, timeoutMs: 15000 });
      console.log(name + ': ' + result.output.trim());
      if (result.code !== 0) failed = true;
    } catch (error) {
      console.log(name + ': ' + error.message);
      failed = true;
    }
  }
  console.log(JSON.stringify({ primary: primaryCheckout(), branch: git(['branch', '--show-current'], repoRoot), pins }, null, 2));
  process.exitCode = failed ? 1 : 0;
} catch (error) { errorExit(error); }
