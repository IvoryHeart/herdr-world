import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const [directory, value] = process.argv.slice(2);
const expected = Number(value);
assert([0, 1].includes(expected), 'Expected reward must be 0 or 1');
const job = JSON.parse(await readFile(join(directory, 'result.json')));
assert(job.n_total_trials > 0, 'No trials ran');
assert.equal(job.stats.n_errored_trials, 0, 'Harbor environment/agent errors occurred');
let count = 0;
for (const entry of await readdir(directory, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const result = JSON.parse(await readFile(join(directory, entry.name, 'result.json')));
  assert.equal(result.verifier_result?.rewards?.reward, expected, entry.name);
  count++;
}
assert.equal(count, job.n_total_trials);
console.log(count + ' trials produced expected reward ' + expected + ' without infrastructure errors.');
