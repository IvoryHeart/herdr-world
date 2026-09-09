import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexSmokeCommand } from './prepare.mjs';

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
