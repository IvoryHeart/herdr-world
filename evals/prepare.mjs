import { readFile, writeFile, mkdir, cp, chmod } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { command, repoRoot, sourceFiles, fingerprint, git, jsonFile } from '../scripts/agent/lib.mjs';

const manifest = JSON.parse(await readFile(join(repoRoot, 'evals/tasks.json'), 'utf8'));
const fingerprintValue = await fingerprint(repoRoot);
const prepared = join(repoRoot, 'evals/.prepared', fingerprintValue.slice(0, 12));
await mkdir(prepared, { recursive: true });
const snapshot = join(prepared, 'snapshot');
await mkdir(snapshot, { recursive: true });
for (const file of await sourceFiles(repoRoot)) {
  // No grader, oracle, previous trial, or Git history is available to the agent.
  if (file.startsWith('evals/') || file.startsWith('.github/')) continue;
  const from = join(repoRoot, file);
  await mkdir(dirname(join(snapshot, file)), { recursive: true });
  try { await cp(from, join(snapshot, file), { recursive: true, dereference: false, verbatimSymlinks: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const archive = join(prepared, 'repo.tar');
const packed = await command(['tar', '-cf', archive, '-C', snapshot, '.'], { stream: false });
if (packed.code !== 0) throw new Error(packed.output);
for (const entry of manifest.cases) {
  const dir = join(prepared, 'tasks', entry.id);
  for (const child of ['environment', 'tests', 'solution']) await mkdir(join(dir, child), { recursive: true });
  await cp(archive, join(dir, 'environment/repo.tar'));
  const mutation = entry.mutant ? "RUN python3 -c \"from pathlib import Path; p=Path('/workspace/web/src/terminalReconnectPolicy.ts'); s=p.read_text(); assert 'Math.min(' in s; p.write_text(s.replace('Math.min(', 'Math.max(', 1))\"\n" : '';
  const knowledge = entry.kind === 'knowledge' ? 'RUN printf "The bridge cannot authenticate browsers.\\nHerdr owns runtime topology.\\n" > /workspace/docs/eval-knowledge.md\n' : '';
  await writeFile(join(dir, 'environment/Dockerfile'), 'FROM herdr-world-agent:1\nUSER root\nCOPY repo.tar /tmp/repo.tar\nRUN mkdir -p /workspace /control && tar -xf /tmp/repo.tar -C /workspace && cp -a /workspace/harness /control/ && mkdir -p /control/scripts && cp -a /workspace/scripts/agent /control/scripts/ && ln -s /opt/harness/node_modules /control/harness/node_modules && ln -s /opt/harness/bin /control/harness/bin\n' + mutation + knowledge +
    'RUN chown -R root:root /workspace /control && cd /workspace && git init -b candidate && git add . && git -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm Baseline && chown -R node:node /workspace\nWORKDIR /workspace\nUSER node\n');
  await writeFile(join(dir, 'instruction.md'), entry.instruction + '\nThe working directory is /workspace. Do not read /tests or /solution; those belong to the evaluator.\n');
  const artifact = entry.kind === 'implementation' ? ['web/src/terminalReconnectPolicy.ts','candidate.ts'] : entry.kind === 'knowledge' ? ['docs/eval-knowledge.md','knowledge.md'] : ['answer.json','answer.json'];
  await writeFile(join(dir, 'task.toml'), 'schema_version = "1.4"\n\n[metadata]\ncategory = "agent-development"\nsource_fingerprint = "' + fingerprintValue + '"\n\n[agent]\ntimeout_sec = 1200\n\n[environment]\ncpus = 4\nmemory_mb = 8192\nnetwork_mode = "public"\n\n[verifier]\ntimeout_sec = 60\nenvironment_mode = "separate"\nnetwork_mode = "no-network"\nuser = "root"\n\n[verifier.environment]\nnetwork_mode = "no-network"\n\n[[artifacts]]\nsource = "/workspace/' + artifact[0] + '"\ndestination = "' + artifact[1] + '"\n');
  await cp(join(repoRoot, 'evals/graders/grade.py'), join(dir, 'tests/grade.py'));
  await writeFile(join(dir, 'tests/case.json'), JSON.stringify(entry));
  await writeFile(join(dir, 'tests/Dockerfile'), 'FROM node:22.23.2-bookworm\nCOPY . /tests\nRUN chmod 755 /tests/test.sh\n');
  await writeFile(join(dir, 'tests/test.sh'), '#!/bin/bash\nset -euo pipefail\nchmod 755 /logs/verifier\nmkdir -p /candidate\ncp -P /workspace/' + artifact[0] + ' /candidate/' + artifact[1] + ' 2>/dev/null || true\nchmod -R a+rX /candidate\npython3 /tests/grade.py /tests/case.json /candidate\n');
  let solve;
  if (entry.kind === 'implementation') solve = "python3 - <<'PY'\nfrom pathlib import Path\np=Path('/workspace/web/src/terminalReconnectPolicy.ts')\np.write_text(p.read_text().replace('Math.max(', 'Math.min(', 1))\nPY\n";
  else if (entry.kind === 'knowledge') solve = "cat > /workspace/docs/eval-knowledge.md <<'ANSWER'\n" + entry.oracle.replaceAll('\\n','\n') + "ANSWER\n";
  else {
    const answer = entry.kind === 'json' ? entry.expected : { findings: entry.expectedFinding ? [{ path: 'web/src/terminalReconnectPolicy.ts', severity: 'high', explanation: 'Math.max makes the retry delay at least 5000 ms and then unbounded; the maximum cap needs Math.min.' }] : [] };
    solve = "cat > /workspace/answer.json <<'ANSWER'\n" + JSON.stringify(answer) + "\nANSWER\n";
  }
  await writeFile(join(dir, 'solution/solve.sh'), '#!/bin/bash\nset -euo pipefail\n' + solve);
  await chmod(join(dir, 'tests/test.sh'), 0o755);
  await chmod(join(dir, 'solution/solve.sh'), 0o755);
}
await jsonFile(join(prepared, 'inputs.json'), { schemaVersion: 1, sourceRevision: git(['rev-parse','HEAD'],repoRoot), sourceFingerprint: fingerprintValue, tools: JSON.parse(await readFile(join(repoRoot,'harness/tool-versions.json'))), cases: manifest.cases.map(c=>c.id), model: null, costUsd: null });
console.log(join(prepared, 'tasks'));
