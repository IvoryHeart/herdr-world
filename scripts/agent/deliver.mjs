import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { git, assertReceipt, command, errorExit, jsonFile } from './lib.mjs';
import { deliveryEvidence, executionMarkdown, readTask } from './task.mjs';
try {
  const { values } = parseArgs({ options: { base: { type: 'string' }, title: { type: 'string' }, 'body-file': { type: 'string' } } });
  if (!values.title || !values['body-file']) throw new Error('Usage: agent:deliver -- --title <title> --body-file <path>');
  const branch = git(['branch', '--show-current']);
  if (!branch || branch === 'main') throw new Error('Delivery requires a non-main branch');
  if (git(['status', '--porcelain'])) throw new Error('Commit the reviewed candidate first; worktree must be clean');
  const receipt = JSON.parse(await readFile('.agents/state/verification.json', 'utf8'));
  await assertReceipt(process.cwd(), receipt);
  const base = values.base ?? (await readTask())?.base ?? 'main';
  const evidence = await deliveryEvidence(process.cwd(), base);
  const body = await readFile(values['body-file'], 'utf8');
  const bodyFile = join(process.cwd(), '.agents/state/delivery-body.md');
  await jsonFile(join(process.cwd(), '.agents/state/execution.json'), evidence);
  await writeFile(bodyFile, body + executionMarkdown(evidence), { mode: 0o600 });
  const push = await command(['git', 'push', '--set-upstream', 'origin', 'HEAD:refs/heads/' + branch]);
  if (push.code !== 0) throw new Error('Branch push failed');
  const result = await command(['gh', 'pr', 'create', '--base', base, '--head', branch, '--title', values.title, '--body-file', bodyFile]);
  process.exitCode = result.code ?? 1;
} catch (error) { errorExit(error); }
