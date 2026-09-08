// Live coordinator routing eval. Actual goal/worktree/job/task commands; only the
// nested run is a stopped intake fixture. No nested model or real publication.
import { mkdir, mkdtemp, writeFile, readFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { command, git, repoRoot, fingerprint, jsonFile } from '../scripts/agent/lib.mjs';
import { copyCandidate } from '../scripts/agent/environment.mjs';
import { startUsage, recoverUsage } from '../scripts/agent/usage.mjs';
import { assessActivation } from './activation-check.mjs';

const { values } = parseArgs({ options: { model: { type: 'string', default: 'gpt-5.6-sol' }, seconds: { type: 'string', default: '180' } } });
const seconds = Number(values.seconds);
if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 600) throw new Error('Use a 1–600 second activation budget');
const parent = join(repoRoot, '.agents/state/activation-evals'); await mkdir(parent, { recursive: true });
const dir = await mkdtemp(join(parent, 'live-')), workspace = join(dir, 'workspace'), evidence = join(dir, 'evidence'), bin = join(dir, 'bin'), home = join(dir, 'sessions/coordinator/home');
for (const p of [evidence, bin, home]) await mkdir(p, { recursive: true });
await copyCandidate(repoRoot, workspace);
await writeFile(join(workspace, 'AGENTS.md'), '\nEvaluation environment: the repository tooling is prepared. Publishing is disabled. Do not install services or contact live deployments.\n', { flag: 'a' });
await writeFile(join(workspace, 'scripts/agent/run.mjs'), `import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {recordTask} from './task.mjs';
import {fingerprint,primaryCheckout,jsonFile,git} from './lib.mjs';
const primary=primaryCheckout(), id=randomUUID();
if(process.argv[2]==='status') {
  console.log(await readFile(join(primary,'.agents/runs',process.argv[3],'run.json'),'utf8'));
} else if(process.argv[2]==='start') {
  const goal=await readFile(process.argv[process.argv.indexOf('--task-file')+1],'utf8');
  const delivery={worktree:process.cwd(),base:process.env.WORLD_AGENT_BASE,parent:process.env.WORLD_AGENT_PARENT};
  const state={id,status:'blocked',workflow:'two-history',delivery,intake:{questions:[{id:'tree-style',question:'Should Tree use an organic illustration or a schematic tree layout?'}]}};
  await jsonFile(join(primary,'.agents/runs',id,'run.json'),state);
  await recordTask(process.cwd(),{mode:'ralph',runId:id,...delivery});
  if(process.env.WORLD_AGENT_JOB_DIR) {
    const path=join(process.env.WORLD_AGENT_JOB_DIR,'job.json');
    await jsonFile(path,{...JSON.parse(await readFile(path,'utf8')),runId:id});
  }
  await jsonFile('/evidence/activation.json',{mode:'ralph',runId:id,parent:delivery.parent,goal,sourceFingerprint:await fingerprint(primary),taskFingerprint:await fingerprint(process.cwd()),sourceRevision:git(['rev-parse','HEAD']),worktree:process.cwd()});
  console.log(JSON.stringify(state)); process.exitCode=1;
} else {throw Error('Only initial intake/status is available in this routing fixture');}
`);
git(['add', '.'], workspace); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Activation fixture'], workspace);
git(['branch', '-m', 'agent/parent-80'], workspace);
git(['clone', '--bare', workspace, join(dir, 'origin.git')], dir);
git(['remote', 'add', 'origin', '/routing-origin'], workspace);
await writeFile(join(bin, 'gh'), `#!/usr/bin/env node
const fs=require('fs');
if(process.argv[2]==='pr' && process.argv[3]==='view') console.log(JSON.stringify({headRefName:'agent/parent-80',headRefOid:process.env.FIXTURE_REVISION,isCrossRepository:false,state:'OPEN',number:80}));
else {fs.writeFileSync('/evidence/publication-attempt','gh');process.exit(88);}
`);
await writeFile(join(bin, 'git'), `#!/usr/bin/env node
const fs=require('fs'), cp=require('child_process'), args=process.argv.slice(2);
if(args.includes('push')) {fs.writeFileSync('/evidence/publication-attempt','git push');process.exit(88);}
const r=cp.spawnSync('/usr/bin/git',args,{stdio:'inherit'});process.exit(r.status??1);
`);
for (const file of ['gh', 'git']) await chmod(join(bin, file), 0o755);
const before = await fingerprint(workspace);
const image = await command(['docker', 'image', 'inspect', 'herdr-world-agent:1', '--format', '{{.Id}}'], { stream: false });
if (image.code !== 0) throw new Error('Build the execution image first');
const name = 'world-activation-' + randomUUID();
const selected = { model: values.model, reasoningEffort: 'high' };
const state = { id: randomUUID(), activations: 1, models: { coordinator: selected } };
const tracker = await startUsage(dir, state, 'coordinator', { home, group: 'coordinator', meta: {} }, { stage: 'activation', timeoutMs: seconds * 1000 });
const prompt = 'Create a fresh worktree from the latest PR #80 and use the repo’s development workflow. Design a Tree theme as another representation of the shared World model. Discuss the design with me before implementing.';
const report = { kind: 'live-coordinator-activation', sourceRevision: git(['rev-parse', 'HEAD'], repoRoot),
  harnessFingerprint: await fingerprint(repoRoot), fixtureFingerprint: before, fixtureRevision: git(['rev-parse', 'HEAD'], workspace),
  image: image.stdout.trim(), ...selected, prompt, startedAt: new Date().toISOString(),
  limitation: 'Nested run is a stopped intake fixture. This measures short-goal routing, not complete Ralph delivery or feature quality.' };
console.log('Activation evidence: ' + dir);
let result;
try {
  result = await command(['docker', 'run', '--rm', '--init', '-i', '--name', name, '--user', String(process.getuid()) + ':' + String(process.getgid()),
    '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=256', '--memory=3g', '--cpus=2', '--read-only', '--tmpfs', '/tmp:rw,exec,size=512m',
    '--mount', 'type=bind,src=' + workspace + ',dst=/workspace',
    '--mount', 'type=bind,src=' + join(workspace, 'scripts/agent') + ',dst=/workspace/scripts/agent,readonly',
    '--mount', 'type=bind,src=' + join(dir, 'origin.git') + ',dst=/routing-origin,readonly',
    '--mount', 'type=bind,src=' + evidence + ',dst=/evidence',
    '--mount', 'type=bind,src=' + home + ',dst=/agent-home',
    '--mount', 'type=bind,src=' + join(homedir(), '.codex/auth.json') + ',dst=/agent-home/auth.json,readonly',
    ...['gh', 'git'].flatMap(file => ['--mount', 'type=bind,src=' + join(bin, file) + ',dst=/usr/local/bin/' + file + ',readonly']),
    '-e', 'CODEX_HOME=/agent-home', '-e', 'HOME=/tmp', '-e', 'OPENSPEC_TELEMETRY=0', '-e', 'DO_NOT_TRACK=1',
    '-e', 'FIXTURE_REVISION=' + report.fixtureRevision, '--workdir', '/workspace', image.stdout.trim(),
    '/opt/harness/node_modules/.bin/codex', 'exec', '--json', '--ignore-user-config', '--model', selected.model,
    '-c', 'model_reasoning_effort="high"', '-c', 'agents.enabled=false', '-c', 'sandbox_mode="danger-full-access"',
    '-c', 'otel.exporter="none"', '-c', 'otel.metrics_exporter="none"', '-c', 'otel.trace_exporter="none"', '-'],
  { input: prompt, timeoutMs: seconds * 1000, stream: false, log: join(dir, 'coordinator.jsonl') });
  let entry = null; try { entry = JSON.parse(await readFile(join(evidence, 'activation.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let publicationAttempted = false; try { await readFile(join(evidence, 'publication-attempt')); publicationAttempted = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  report.failures = assessActivation({ entry, before, after: await fingerprint(workspace), expectedParent: '80', publicationAttempted });
  if (entry?.taskFingerprint !== before) report.failures.push('Task worktree did not preserve the selected parent source');
  if (result.code !== 0) report.failures.push('Coordinator failed or timed out');
  report.entry = entry;
  report.status = report.failures.length ? 'failed' : 'passed';
  if (report.status !== 'passed') process.exitCode = 1;
} finally {
  await command(['docker', 'rm', '-f', name], { stream: false }).catch(() => {});
  await tracker.finish(result ?? { code: null, interrupted: true });
  report.usage = await recoverUsage(dir, { interrupted: true });
  report.finishedAt = new Date().toISOString();
  await jsonFile(join(dir, 'report.json'), report);
  console.log(JSON.stringify({ status: report.status, failures: report.failures, usage: report.usage.usage, lowerBound: report.usage.lowerBound }, null, 2));
}
