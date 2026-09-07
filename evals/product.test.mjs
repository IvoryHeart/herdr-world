import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, cp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { seedMutations } from './product.mjs';
import { repoRoot } from '../scripts/agent/lib.mjs';

test('product workloads seed real source and refuse silently stale mutations', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'world-product-seeds-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cases = JSON.parse(await readFile(join(repoRoot, 'evals/product-cases.json'))).cases;
  assert(cases.length >= 3);
  for (const entry of cases) {
    const workspace = join(directory, entry.id);
    for (const path of new Set(entry.mutations.map(m => m.path))) {
      await mkdir(dirname(join(workspace, path)), { recursive: true }); await cp(join(repoRoot, path), join(workspace, path));
    }
    await seedMutations(workspace, entry);
    for (const mutation of entry.mutations) assert((await readFile(join(workspace, mutation.path), 'utf8')).includes(mutation.to));
    await assert.rejects(seedMutations(workspace, entry), /Seed no longer applies/);
    await readFile(join(repoRoot, 'web/src', entry.unit));
    assert(entry.browser.length && entry.brief.length);
  }
});
