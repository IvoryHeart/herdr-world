// Freeze the existing reconnect regression as a small installation/behavior smoke.
// The owner's terminal visibility/navigation bug needs its own reproduction first.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../..');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
export function codexSmokeCommand(codex) {
  return quote(codex) + ' sandbox --permission-profile :workspace -- true && '
    + 'timeout --signal=INT --kill-after=15s 300s ' + quote(codex)
    + ' exec --sandbox workspace-write --skip-git-repo-check --json --model gpt-5.6-luna'
    + ' -c ' + quote('approval_policy="never"')
    + ' -c ' + quote('model_reasoning_effort="xhigh"') + ' -c ' + quote('agents.enabled=false');
}

export async function prepareSmoke(output) {
  await mkdir(output, { recursive: false, mode: 0o700 });
  const source = await readFile(join(root, 'web/src/terminalReconnectPolicy.ts'), 'utf8');
  if (!source.includes('Math.min(')) throw new Error('Reconnect smoke seed no longer matches source; review this task');
  await writeFile(join(output, 'candidate.ts'), source.replace('Math.min(', 'Math.max('));
  await writeFile(join(output, 'reference.ts'), source);
  // Reference validation is explicit and makes no model calls. It is not part
  // of live workspace mappings; the candidate never receives this solution.
  await writeFile(join(output, 'reference.sh'), 'cp ' + quote(join(output, 'reference.ts')) + ' candidate.ts\n');
  const sharedGrader = join(directory, '../graders/grade.py');
  const pilotGrader = join(directory, 'grade-reconnect.py');
  const snapshotRoot = join(output, 'graders');
  const pilotSnapshotRoot = join(output, 'pilots');
  // Preserve the source layout because grade-reconnect.py imports ../graders/grade.py.
  await mkdir(snapshotRoot);
  await mkdir(pilotSnapshotRoot);
  await cp(sharedGrader, join(snapshotRoot, 'grade.py'));
  await cp(pilotGrader, join(pilotSnapshotRoot, 'grade-reconnect.py'));
  const codex = join(root, 'harness/node_modules/.bin/codex');
  const agent = codexSmokeCommand(codex);
  const spec = {
    version: '1', skill: join(root, '.agents/skills/superpowers/systematic-debugging'),
    defaults: { agent: 'command', command: agent, provider: 'local', trials: 1, timeout: 360, threshold: 1 },
    tasks: [{ name: 'reconnect-smoke', metadata: { scope: 'tool-smoke', userBug: false },
      instruction: 'Investigate and fix candidate.ts using systematic debugging. Ordinary retries start at 500ms, double per attempt and cap at 5000ms. Immediate retries have zero delay without advancing the attempt. Preserve foreground timeout and fast-attempt accounting. Reproduce the defect and verify the correction. This is a synthetic eval workspace: edit candidate.ts only, do not start subagents, publish, or create a worktree. If a file or command tool repeatedly fails for the same environment reason, stop and report that blocker instead of retrying equivalent operations.',
      workspace: [{ src: 'candidate.ts', dest: 'candidate.ts' }],
      solution: 'reference.sh',
      graders: [{ type: 'deterministic', run: 'python3 ' + quote(join(pilotSnapshotRoot, 'grade-reconnect.py')), weight: 1 }] }],
  };
  await writeFile(join(output, 'eval.yaml'), JSON.stringify(spec, null, 2) + '\n');
  const controls = structuredClone(spec);
  controls.tasks[0].workspace = [
    { src: '../candidate.ts', dest: 'candidate.ts' },
    { src: '../reference.sh', dest: 'reference.sh' },
  ];
  controls.tasks[0].solution = '../reference.sh';
  controls.skill = spec.skill;
  await mkdir(join(output, 'controls'));
  await writeFile(join(output, 'controls/eval.yaml'), JSON.stringify(controls, null, 2) + '\n');
  await writeFile(join(output, 'inputs.json'), JSON.stringify({
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    skillgrade: '0.3.0', openwiki: '0.5.0', superpowers: '6.3.0', codex: '0.153.4',
    graderFiles: {
      'evals/graders/grade.py': {
        sha256: createHash('sha256').update(await readFile(sharedGrader)).digest('hex'),
        snapshot: 'graders/grade.py',
      },
      'evals/pilots/grade-reconnect.py': {
        sha256: createHash('sha256').update(await readFile(pilotGrader)).digest('hex'),
        snapshot: 'pilots/grade-reconnect.py',
      },
    },
    model: 'gpt-5.6-luna', effort: 'xhigh', trials: 1, cost: null,
    scope: 'Existing seeded reconnect smoke; not the owner terminal visibility/navigation reproduction',
    isolation: 'local temporary copy with native Codex workspace sandbox; not an adversarially isolated grader',
  }, null, 2) + '\n');
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const parent = join(root, '.agents/state/pilots');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  console.log(await prepareSmoke(join(parent, 'reconnect-' + new Date().toISOString().replaceAll(':', '-'))));
}
