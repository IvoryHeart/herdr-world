import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { git, assertReceipt, command, errorExit } from './lib.mjs';
try {
  const { values } = parseArgs({ options: { title: { type: 'string' }, 'body-file': { type: 'string' } } });
  if (!values.title || !values['body-file']) throw new Error('Usage: agent:deliver -- --title <title> --body-file <path>');
  const branch = git(['branch', '--show-current']);
  if (!branch || branch === 'main') throw new Error('Delivery requires a non-main branch');
  if (git(['status', '--porcelain'])) throw new Error('Commit the reviewed candidate first; worktree must be clean');
  const receipt = JSON.parse(await readFile('.agents/state/verification.json', 'utf8'));
  await assertReceipt(process.cwd(), receipt);
  await readFile(values['body-file'], 'utf8');
  const push = await command(['git', 'push', '--set-upstream', 'origin', 'HEAD:refs/heads/' + branch]);
  if (push.code !== 0) throw new Error('Branch push failed');
  const result = await command(['gh', 'pr', 'create', '--base', 'main', '--head', branch, '--title', values.title, '--body-file', values['body-file']]);
  process.exitCode = result.code ?? 1;
} catch (error) { errorExit(error); }
