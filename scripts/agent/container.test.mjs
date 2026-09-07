import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, readdir, access, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { command, git, repoRoot } from './lib.mjs';

test('production supervisor enforces isolation, verification, blocked outcomes and interrupted recovery', { timeout: 900000 }, async (t) => {
  const parent = join(repoRoot, '.agents/state/container-tests');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'fixture-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const build = join(dir, 'image');
  await mkdir(build);
  await writeFile(join(build, 'fake-codex.mjs'), `#!/usr/bin/env node
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
const home=process.env.CODEX_HOME, file=home+'/fixture-history.json';
let history=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)): {id:randomUUID(),turns:0};
const resume=process.argv.indexOf('resume');
if(resume>=0 && process.argv[resume+1]!==history.id) throw Error('Wrong native thread');
if(resume<0 && history.turns) throw Error('Existing history was not resumed');
history.turns++; fs.writeFileSync(file,JSON.stringify(history));
console.log(JSON.stringify({type:'thread.started',thread_id:history.id}));
if(process.argv.includes('--version')) { console.log('codex-cli fixture (no model)'); process.exit(0); }
let prompt=''; for await(const chunk of process.stdin) prompt+=chunk;
const context=JSON.parse(prompt.split('Supervisor context updates:\\n')[1].split('\\n\\nCandidate changes')[0]);
history.context={...history.context,...context}; fs.writeFileSync(file,JSON.stringify(history));
prompt+='\\nSaved native fixture context: '+JSON.stringify(history.context);
let event,fields={};
const acceptance=[{id:'answer',criterion:'source.mjs exports answer equal to 42.'}];
if(prompt.startsWith('Use world-start-task')) {event=prompt.includes('OWNER_ANSWER')?'intake.ready':'intake.questions';fields={acceptance:event==='intake.ready'?acceptance:[],questions:event==='intake.questions'?[{id:'value',question:'What value should answer have?'}]:[]};}
else if(prompt.startsWith('Use world-shape-work')) {event='requirements.ready';fields={acceptance};}
else if(prompt.startsWith('Read AGENTS.md and world-plan-change')) {event=prompt.includes('FIXTURE_BLOCKED')?'task.blocked':'plan.ready';fields={acceptance,specialists:[]};}
else if(prompt.startsWith('Use world-test-behavior to derive')) {event='qa.planned';fields={scenarios:[{id:'value',acceptanceIds:['answer'],steps:'Read source.mjs.',expected:'answer is 42.'}]};}
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
} else if(prompt.startsWith('Use world-test-behavior to execute')) {
  try { fs.writeFileSync('/workspace/source.mjs','tampered'); throw Error('QA writable'); }
  catch(error) { if(error.message==='QA writable') throw error; }
  event='qa.passed';fields={results:[{scenarioId:'value',status:'passed',evidence:'Fixture claims pass; independent verifier must still check.'}]};
} else if(prompt.startsWith('Use world-consult-oracle')) event='oracle.advised';
else throw Error('Unexpected model role');
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({event,summary:'Deterministic container fixture; no model called.',...fields})}}));
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
    '--model','fixture','--image',image,'--auth-file',auth,'--seconds','300'];
  result=await command(args,{cwd:source,stream:false,timeoutMs:360000,log:join(dir,'success.log')});
  assert.equal(result.code,0,result.output);
  const runBase=join(source,'.agents/runs');
  let runs=await readdir(runBase);
  const success=JSON.parse(await readFile(join(runBase,runs[0],'run.json')));
  assert.equal(success.status,'ready-for-review');
  assert.equal(success.turns.find(t=>t.role==='reviewer').sessionId,success.turns.find(t=>t.role==='qa-planner').sessionId);
  assert(success.turns.find(t=>t.role==='qa').resumed);
  assert.notEqual(success.sessions.builder.threadId,success.sessions.review.threadId);
  assert.equal(success.qa.event,'qa.passed');
  assert.equal(success.models.implementer.model,'fixture');
  assert.equal(success.turns.find(turn=>turn.role==='qa').reasoningEffort,'xhigh');
  assert.match(await readFile(join(runBase,runs[0],'candidate.patch'),'utf8'),/answer = 42/);
  assert.equal(await readFile(join(source,'source.mjs'),'utf8'),'export const answer = 0;\n');
  await writeFile(task,'FIXTURE_BLOCKED: missing owner decision; stop.');
  result=await command(args,{cwd:source,stream:false,timeoutMs:360000,log:join(dir,'blocked.log')});
  assert.notEqual(result.code,0);
  const blockedId=(await readdir(runBase)).find(id=>!runs.includes(id));
  assert.equal(JSON.parse(await readFile(join(runBase,blockedId,'run.json'))).status,'blocked');
  runs=await readdir(runBase);
  await writeFile(task,'FIXTURE_RESUME: Make answer equal 42 after interruption.');
  const pending=command(args,{cwd:source,stream:false,timeoutMs:360000,log:join(dir,'interrupted.log')});
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
  const builderBefore=JSON.parse(await readFile(join(runBase,resumeId,'sessions/builder/session.json')));
  assert(builderBefore.threadId);
  result=await command([process.execPath,join(repoRoot,'scripts/agent/run.mjs'),'resume',resumeId],
    {cwd:source,stream:false,timeoutMs:360000,log:join(dir,'resumed.log')});
  assert.equal(result.code,0,result.output);
  const resumed=JSON.parse(await readFile(join(runBase,resumeId,'run.json')));
  assert.equal(resumed.status,'ready-for-review');
  assert.equal(resumed.sessions.builder.threadId,builderBefore.threadId);
  assert(resumed.activations>interrupted.activations);
  assert(resumed.remainingMs<interrupted.remainingMs);
  runs=await readdir(runBase);
  git(['clone','--bare',source,join(dir,'origin.git')],dir);
  git(['remote','add','origin',join(dir,'origin.git')],source);
  await mkdir(join(dir,'bin'));
  const gh=join(dir,'bin/gh');
  await writeFile(gh,'#!/usr/bin/env node\nconsole.log(JSON.stringify({headRefName:"agent/fixture",isCrossRepository:false,state:"OPEN"}));\n');
  await chmod(gh,0o755);
  result=await command([process.execPath,join(repoRoot,'scripts/agent/goal.mjs'),'Ask the owner what answer should be, then implement it.',
    '--parent','78','--slug','interview-fixture','--profile','check','--image',image,'--auth-file',auth,'--model','fixture','--seconds','300'],
    {cwd:source,stream:false,timeoutMs:360000,env:{...process.env,PATH:join(dir,'bin')+':'+process.env.PATH}});
  assert.notEqual(result.code,0);
  const intakeId=(await readdir(runBase)).find(id=>!runs.includes(id));
  const intake=JSON.parse(await readFile(join(runBase,intakeId,'run.json')));
  assert.equal(intake.status,'blocked'); assert.equal(intake.intake.questions.length,1);
  assert.equal(intake.delivery.base,'agent/fixture'); assert.equal(intake.delivery.parent,'78');
  assert.equal(intake.delivery.worktree,join(source,'.agents/.worktrees/interview-fixture'));
  assert.equal(git(['branch','--show-current'],source),'agent/fixture');
  const noAnswer=await command([process.execPath,join(repoRoot,'scripts/agent/run.mjs'),'resume',intakeId],{cwd:source,stream:false});
  assert.notEqual(noAnswer.code,0);
  await writeFile(task,'OWNER_ANSWER: answer must equal 42.');
  result=await command([process.execPath,join(repoRoot,'scripts/agent/run.mjs'),'resume',intakeId,'--task-file',task],{cwd:source,stream:false,timeoutMs:360000});
  assert.equal(result.code,0,result.output);
  const answered=JSON.parse(await readFile(join(runBase,intakeId,'run.json')));
  assert.equal(answered.status,'ready-for-review'); assert(answered.remainingMs<intake.remainingMs);
  assert.equal(answered.turns.filter(t=>t.sessionGroup==='lead').length,3);
  assert.equal(new Set(answered.turns.filter(t=>t.sessionGroup==='lead').map(t=>t.sessionId)).size,1);
  runs=await readdir(runBase);
  await writeFile(task,'FIXTURE_FAIL: Repeatedly claim success while the check fails.');
  result=await command(args,{cwd:source,stream:false,timeoutMs:360000,log:join(dir,'failed.log')});
  assert.notEqual(result.code,0);
  const failedId=(await readdir(runBase)).find(id=>!runs.includes(id));
  const failed=JSON.parse(await readFile(join(runBase,failedId,'run.json')));
  assert.equal(failed.status,'exhausted');
  assert.equal(failed.verification?.status,'failed',JSON.stringify(failed));
  assert.equal(failed.oracle.consultations,1);
});
