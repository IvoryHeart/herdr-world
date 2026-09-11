import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codexSmokeCommand, prepareSmoke } from './prepare.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));

test('failed sandbox preflight prevents a model invocation, including executable paths with spaces and quotes', async t => {
  const directory = await mkdtemp(join(tmpdir(), "pilot's command "));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fake = join(directory, 'codex');
  await writeFile(fake, '#!/bin/sh\nif [ "$1" = sandbox ]; then echo synthetic-sandbox-failure >&2; exit 23; fi\necho MODEL_STARTED\n', { mode: 0o755 });
  const result = spawnSync('sh', ['-c', codexSmokeCommand(fake)], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 23);
  assert.match(result.stderr, /synthetic-sandbox-failure/);
  assert.doesNotMatch(result.stdout, /MODEL_STARTED/);
});

test('prepared pilots snapshot both grader files and reference the snapshots', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'world-pilot-snapshot-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const prepared = await prepareSmoke(join(parent, 'prepared'));
  const spec = JSON.parse(await readFile(join(prepared, 'eval.yaml'), 'utf8'));
  const graderRun = spec.tasks[0].graders[0].run;
  assert.match(graderRun, new RegExp(`${prepared}/pilots/grade-reconnect\\.py`));
  assert.doesNotMatch(graderRun, /evals\/pilots\/grade-reconnect\.py/);
  assert.equal(await readFile(join(prepared, 'pilots/grade-reconnect.py'), 'utf8'),
    await readFile(join(directory, 'grade-reconnect.py'), 'utf8'));
  assert.equal(await readFile(join(prepared, 'graders/grade.py'), 'utf8'),
    await readFile(join(directory, '../graders/grade.py'), 'utf8'));
  const inputs = JSON.parse(await readFile(join(prepared, 'inputs.json'), 'utf8'));
  assert.deepEqual(Object.keys(inputs.graderFiles).sort(), [
    'evals/graders/grade.py', 'evals/pilots/grade-reconnect.py',
  ]);
  assert.equal(inputs.graderFiles['evals/graders/grade.py'].snapshot, 'graders/grade.py');
  assert.equal(inputs.graderFiles['evals/pilots/grade-reconnect.py'].snapshot, 'pilots/grade-reconnect.py');
});
