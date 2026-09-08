import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { git, assertReceipt, command, errorExit, jsonFile } from './lib.mjs';
import { deliveryEvidence, draftEvidence, executionMarkdown, readTask } from './task.mjs';
try {
  const { values } = parseArgs({ options: { draft: { type: 'boolean', default: false }, ready: { type: 'string' }, base: { type: 'string' }, title: { type: 'string' }, 'body-file': { type: 'string' } } });
  if (!values.title || !values['body-file']) throw new Error('Usage: agent:deliver -- --title <title> --body-file <path>');
  const branch = git(['branch', '--show-current']);
  if (!branch || branch === 'main') throw new Error('Delivery requires a non-main branch');
  if (git(['status', '--porcelain'])) throw new Error('Commit the reviewed candidate first; worktree must be clean');
  if (values.draft && values.ready) throw new Error('Choose a draft checkpoint or ready delivery');
  if (values.ready && !/^[1-9][0-9]*$/.test(values.ready)) throw new Error('--ready needs a PR number');
  if (!values.draft) {
    const receipt = JSON.parse(await readFile('.agents/state/verification.json', 'utf8'));
    await assertReceipt(process.cwd(), receipt);
  }
  const base = values.base ?? (await readTask())?.base ?? 'main';
  const evidence = await (values.draft ? draftEvidence : deliveryEvidence)(process.cwd(), base);
  if (values.ready) {
    const found = await command(['gh', 'pr', 'view', values.ready, '--json', 'headRefName,baseRefName,isCrossRepository,isDraft'], { stream: false });
    if (found.code !== 0) throw new Error('Could not inspect draft PR');
    const pr = JSON.parse(found.output);
    if (pr.isCrossRepository || !pr.isDraft || pr.headRefName !== branch || pr.baseRefName !== base) throw new Error('Ready delivery must match this branch and draft parent');
  }
  const body = await readFile(values['body-file'], 'utf8');
  const bodyFile = join(process.cwd(), '.agents/state/delivery-body.md');
  await jsonFile(join(process.cwd(), '.agents/state/execution.json'), evidence);
  await writeFile(bodyFile, body + executionMarkdown(evidence), { mode: 0o600 });
  const push = await command(['git', 'push', '--set-upstream', 'origin', 'HEAD:refs/heads/' + branch]);
  if (push.code !== 0) throw new Error('Branch push failed');
  let result;
  if (values.ready) {
    const payload = join(process.cwd(), '.agents/state/pr-update.json');
    await jsonFile(payload, { title: values.title, body: await readFile(bodyFile, 'utf8') });
    const update = await command(['gh', 'api', '--method', 'PATCH', 'repos/{owner}/{repo}/pulls/' + values.ready, '--input', payload, '--jq', '.html_url']);
    if (update.code !== 0) throw new Error('Draft evidence update failed');
    result = await command(['gh', 'pr', 'ready', values.ready]);
  } else result = await command(['gh', 'pr', 'create', ...(values.draft ? ['--draft'] : []), '--base', base, '--head', branch, '--title', values.title, '--body-file', bodyFile]);
  process.exitCode = result.code ?? 1;
} catch (error) { errorExit(error); }
