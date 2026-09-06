import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, readdir, access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { command, git, repoRoot } from './lib.mjs';

test('production supervisor enforces isolation, verification, blocked outcomes and interrupted recovery', { timeout: 600000 }, async (t) => {
  const parent = join(repoRoot, '.agents/state/container-tests');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'fixture-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const build = join(dir, 'image');
  await mkdir(build);
  await writeFile(join(build, 'fake-codex.mjs'), `#!/usr/bin/env node
import fs from 'node:fs';
if(process.argv.includes('--version')) { console.log('codex-cli fixture (no model)'); process.exit(0); }
let prompt=''; for await(const chunk of process.stdin) prompt+=chunk;
let event;
if(prompt.startsWith('Read AGENTS.md and world-plan-change')) event=prompt.includes('FIXTURE_BLOCKED')?'task.blocked':'plan.ready';
else if(prompt.startsWith('Implement the authorized task')) {
  if(prompt.includes('FIXTURE_RESUME') && !fs.existsSync('/workspace/.agents/fixture-pause')) {
    fs.writeFileSync('/workspace/.agents/fixture-pause','pause');
    await new Promise(resolve=>setTimeout(resolve,30000));
  }
  fs.writeFileSync('/workspace/source.mjs',prompt.includes('FIXTURE_FAIL')?'export const answer = 0;\\n':'export const answer = 42;\\n');
  try { fs.writeFileSync('/workspace/.git/config','tampered'); throw Error('Git metadata writable'); }
  catch(error) { if(error.message==='Git metadata writable') throw error; }
  try { fs.writeFileSync('/workspace/.ralph/agent/scratchpad.md','tampered'); throw Error('Supervisor metadata writable'); }
  catch(error) { if(error.message==='Supervisor metadata writable') throw error; }
  event='candidate.ready';
} else if(prompt.startsWith('Use world-review-change')) {
  try { fs.writeFileSync('/workspace/source.mjs','tampered'); throw Error('Review writable'); }
  catch(error) { if(error.message==='Review writable') throw error; }
  event='review.passed';
} else throw Error('Unexpected model role');
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({event,summary:'Deterministic container fixture; no model called.'})}}));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:0,output_tokens:0}}));
`);
  await writeFile(join(build, 'Dockerfile'), 'FROM herdr-world-agent:1\nUSER root\nCOPY fake-codex.mjs /opt/harness/node_modules/@openai/codex/bin/codex.js\nRUN chmod 755 /opt/harness/node_modules/@openai/codex/bin/codex.js\nUSER node\n');
  const image = 'world-agent-fixture:' + process.pid;
  let result = await command(['docker','build','-t',image,build], { stream:false,timeoutMs:120000 });
  assert.equal(result.code,0,result.output);
  const source = join(dir,'source');
  await mkdir(source);
  git(['init','-b','agent/fixture'],source);
  await writeFile(join(source,'.gitignore'),'.agents/\n.ralph/\nnode_modules/\n**/node_modules/\n**/target/\n');
  await writeFile(join(source,'source.mjs'),'export const answer = 0;\n');
  await writeFile(join(source,'check.mjs'),"import {answer} from './source.mjs'; if(answer !== 42) process.exit(1);\n");
  for(const prefix of ['', 'web', 'harness']) {
    const where=join(source,prefix); await mkdir(where,{recursive:true});
    const pkg={name:'fixture-'+(prefix||'root'),version:'1.0.0',private:true,scripts:prefix?{}:{check:'node check.mjs'}};
    await writeFile(join(where,'package.json'),JSON.stringify(pkg));
    const lock=await command(['npm','install','--package-lock-only','--ignore-scripts'],{cwd:where,stream:false});
    assert.equal(lock.code,0,lock.output);
  }
  for(const prefix of ['bridge','vendor/herdr-compat']) {
    const where=join(source,prefix); await mkdir(join(where,'src'),{recursive:true});
    await writeFile(join(where,'Cargo.toml'),'[package]\nname = "fixture-'+(prefix==='bridge'?'bridge':'compat')+'"\nversion = "0.1.0"\nedition = "2021"\n');
    await writeFile(join(where,'src/lib.rs'),'pub fn fixture() {}\n');
    const lock=await command(['cargo','generate-lockfile'],{cwd:where,stream:false});
    assert.equal(lock.code,0,lock.output);
  }
  git(['add','.'],source);
  git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Fixture'],source);
  const auth=join(dir,'auth.json'); await writeFile(auth,'{}');
  const task=join(dir,'task.md'); await writeFile(task,'Make answer equal 42; this is a deterministic fixture.');
  const args=[process.execPath,join(repoRoot,'scripts/agent/run.mjs'),'start','--task-file',task,
    '--model','fixture','--image',image,'--auth-file',auth,'--seconds','120'];
  result=await command(args,{cwd:source,stream:false,timeoutMs:180000,log:join(dir,'success.log')});
  assert.equal(result.code,0,result.output);
  const runBase=join(source,'.agents/runs');
  let runs=await readdir(runBase);
  const success=JSON.parse(await readFile(join(runBase,runs[0],'run.json')));
  assert.equal(success.status,'ready-for-review');
  assert.match(await readFile(join(runBase,runs[0],'candidate.patch'),'utf8'),/answer = 42/);
  assert.equal(await readFile(join(source,'source.mjs'),'utf8'),'export const answer = 0;\n');
  await writeFile(task,'FIXTURE_BLOCKED: missing owner decision; stop.');
  result=await command(args,{cwd:source,stream:false,timeoutMs:180000,log:join(dir,'blocked.log')});
  assert.notEqual(result.code,0);
  const blockedId=(await readdir(runBase)).find(id=>!runs.includes(id));
  assert.equal(JSON.parse(await readFile(join(runBase,blockedId,'run.json'))).status,'blocked');
  runs=await readdir(runBase);
  await writeFile(task,'FIXTURE_RESUME: Make answer equal 42 after interruption.');
  const pending=command(args,{cwd:source,stream:false,timeoutMs:180000,log:join(dir,'interrupted.log')});
  let settled = false;
  pending.then(() => { settled = true; }, () => { settled = true; });
  let resumeId;
  const deadline=Date.now()+150000;
  while(Date.now()<deadline) {
    if (settled) break;
    resumeId=(await readdir(runBase)).find(id=>!runs.includes(id));
    if(resumeId) {
      try {
        await access(join(runBase,resumeId,'workspace/.agents/fixture-pause'));
        const pid=Number(await readFile(join(runBase,resumeId,'supervisor.lock'),'utf8'));
        process.kill(pid,'SIGTERM');
        break;
      } catch(error) { if(error.code!=='ENOENT') throw error; }
    }
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert.notEqual((await pending).code,0);
  const interrupted=JSON.parse(await readFile(join(runBase,resumeId,'run.json')));
  assert.equal(interrupted.status,'interrupted');
  result=await command([process.execPath,join(repoRoot,'scripts/agent/run.mjs'),'resume',resumeId],
    {cwd:source,stream:false,timeoutMs:180000,log:join(dir,'resumed.log')});
  assert.equal(result.code,0,result.output);
  const resumed=JSON.parse(await readFile(join(runBase,resumeId,'run.json')));
  assert.equal(resumed.status,'ready-for-review');
  assert(resumed.activations>interrupted.activations);
  assert(resumed.remainingMs<interrupted.remainingMs);
  runs=await readdir(runBase);
  await writeFile(task,'FIXTURE_FAIL: Repeatedly claim success while the check fails.');
  result=await command(args,{cwd:source,stream:false,timeoutMs:180000,log:join(dir,'failed.log')});
  assert.notEqual(result.code,0);
  const failedId=(await readdir(runBase)).find(id=>!runs.includes(id));
  const failed=JSON.parse(await readFile(join(runBase,failedId,'run.json')));
  assert.equal(failed.status,'exhausted');
  assert.equal(failed.verification.status,'failed');
});
