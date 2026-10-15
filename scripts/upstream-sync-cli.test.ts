import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const helper = resolve(import.meta.dir, "upstream-sync.ts");
const realGit = Bun.which("git")!;
const repo = "example/world";
const actor = "github-actions[bot]";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "world-upstream-cli-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const git = (...args: string[]) =>
    execFileSync(realGit, ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trimEnd();
  const write = (path: string, text: string) =>
    writeFileSync(join(root, path), text);
  const commit = (message: string) => {
    git("add", "--all");
    git("commit", "-qm", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "-q", "-b", "source");
  git("config", "user.name", "Example Agent");
  git("config", "user.email", "agent@example.invalid");
  git("config", "core.hooksPath", "/dev/null");
  write("source.txt", "zero\n");
  const source0 = commit("Source zero");
  write("source.txt", "one\n");
  const source1 = commit("Source one");
  write("source.txt", "two\n");
  const source2 = commit("Source two");
  git("checkout", "-qb", "main", source0);
  write(
    ".gitignore",
    "bin/\nstate.json\ncalls.jsonl\nevent.json\noutput\nverdict.json\n.agents/\n",
  );
  const record = (sha: string) =>
    write("UPSTREAM.md", `Roamgate source: v1.0.0, \`${sha}\`\n`);
  record(source0);
  write("CHANGELOG.md", "Initial\n");
  const main = commit("World baseline");
  git("checkout", "-qb", "candidate");
  git("merge", "--no-commit", "--no-ff", source1);
  record(source1);
  const head = commit("Integrate source one");
  git("checkout", "main");
  const sync = {
    base: source0,
    target: source1,
    tag: "v1.0.1",
    repair: 0,
    head,
  };
  const statePath = join(root, "state.json");
  const callsPath = join(root, "calls.jsonl");
  let state: any = {
    main,
    head,
    actor,
    issues: [],
    pr: {
      number: 1,
      state: "open",
      draft: false,
      user: { login: actor },
      body: `<!-- upstream-sync ${JSON.stringify(sync)} -->`,
      head: { sha: head, ref: "upstream/roamgate", repo: { full_name: repo } },
      base: { sha: main, ref: "main", repo: { full_name: repo } },
    },
    ci: {
      name: "CI",
      path: ".github/workflows/ci.yml",
      head_sha: head,
      head_branch: "upstream/roamgate",
      head_repository: { full_name: repo },
      status: "completed",
      conclusion: "success",
    },
  };
  const save = () => writeFileSync(statePath, JSON.stringify(state));
  const load = () => {
    state = JSON.parse(readFileSync(statePath, "utf8"));
    return state;
  };
  save();
  writeFileSync(callsPath, "");
  const prelude = `#!${process.execPath}\nimport {readFileSync,writeFileSync,appendFileSync} from 'node:fs';\nimport {execFileSync} from 'node:child_process';\nconst statePath=process.env.FAKE_STATE; const state=JSON.parse(readFileSync(statePath,'utf8')); const args=process.argv.slice(2);\nconst save=()=>writeFileSync(statePath,JSON.stringify(state)); const record=(body)=>appendFileSync(process.env.FAKE_CALLS,JSON.stringify({tool:process.argv[1].endsWith('/git')?'git':'gh',args,body})+'\\n');\n`;
  writeFileSync(
    join(bin, "git"),
    prelude +
      `
const at=args.indexOf('fetch');
if(at>=0){record(); const ref=args.at(-1); const sha=ref==='main'?state.main:ref==='upstream/roamgate'?state.head:ref; execFileSync(process.env.REAL_GIT,['update-ref','FETCH_HEAD',sha]); if(ref==='main')execFileSync(process.env.REAL_GIT,['update-ref','refs/remotes/origin/main',sha]);}
else if(args.includes('ls-remote')) { record(); process.stdout.write(state.pr?state.head+'\\trefs/heads/upstream/roamgate\\n':''); }
else if(args[0]==='push'){ record(); state.head=execFileSync(process.env.REAL_GIT,['rev-parse','HEAD'],{encoding:'utf8'}).trim(); if(state.pr)state.pr.head.sha=state.head; save(); }
else process.stdout.write(execFileSync(process.env.REAL_GIT,args));
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, "gh"),
    prelude +
      `
const body=args.includes('--input')?JSON.parse(readFileSync(0,'utf8')):null; record(body);
if(args[0]==='auth'||args[0]==='workflow')process.exit(0);
if(args[0]!=='api')throw Error('Unexpected gh command');
const path=args[1]; const method=args.includes('--method')?args[args.indexOf('--method')+1]:'GET'; let value;
if(path.endsWith('/actions/variables/UPSTREAM_SYNC_ENABLED'))value={value:'true'};
else if(path.endsWith('/git/ref/heads/main'))value={object:{sha:state.main}};
else if(path==='user')value={login:state.actor};
else if(path.includes('/actions/runs/'))value=state.ci;
else if(path.includes('/actions/workflows/ci.yml/runs'))value={workflow_runs:[]};
else if(path.endsWith('/dispatches')){save();process.exit(0);}
else if(path.includes('/reviews')){value=[];}
else if(path.includes('/issues?'))value=args.includes('--slurp')?[state.issues]:state.issues;
else if(path.endsWith('/issues')&&body){value={number:state.issues.length+10,...body,user:{login:state.actor}};state.issues.push(value);}
else if(/\\/issues\\/\\d+$/.test(path)&&body){const issue=state.issues.find(i=>i.number===Number(path.split('/').at(-1))); Object.assign(issue,body);value=issue;}
else if(path.includes('/pulls?'))value=state.pr?[state.pr]:[];
else if(path.endsWith('/pulls')&&body){state.pr={number:1,state:'open',draft:false,user:{login:state.actor},body:body.body,head:{sha:state.head,ref:body.head,repo:{full_name:'${repo}'}},base:{sha:state.main,ref:'main',repo:{full_name:'${repo}'}}};value=state.pr;}
else if(/\\/pulls\\/\\d+$/.test(path)){if(method==='PATCH')Object.assign(state.pr,body);value=state.pr;}
else throw Error('Unexpected route '+path);
save();process.stdout.write(JSON.stringify(value));
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(root, "verdict.json"),
    JSON.stringify({
      decision: "approve",
      summary: "Reviewed the synthetic integration and its consumer evidence.",
    }),
  );
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    REAL_GIT: realGit,
    FAKE_STATE: statePath,
    FAKE_CALLS: callsPath,
    GITHUB_REPOSITORY: repo,
    GITHUB_ACTIONS: "false",
    GITHUB_OUTPUT: join(root, "output"),
    GITHUB_EVENT_PATH: join(root, "event.json"),
    SYNC: JSON.stringify({ ...sync, pr: 1 }),
    REVIEW_BASE: main,
    REVIEW_RUN_ID: "123",
  };
  const run = (
    mode: string,
    extra: Record<string, string> = {},
    cwd = root,
    args: string[] = [],
  ) => {
    const result = Bun.spawnSync([process.execPath, helper, mode, ...args], {
      cwd,
      env: { ...env, ...extra },
      stdout: "pipe",
      stderr: "pipe",
    });
    return { ...result, status: result.exitCode };
  };
  const calls = () =>
    readFileSync(callsPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  const advance = (source = source0) => {
    git("checkout", "main");
    if (source !== source0) git("merge", "--no-commit", "--no-ff", source);
    record(source);
    write("main-note.txt", "main advanced\n");
    const next = commit("Advance main");
    state = load();
    state.main = next;
    state.pr.base.sha = next;
    save();
    return next;
  };
  return {
    root,
    git,
    write,
    record,
    commit,
    main,
    head,
    source0,
    source1,
    source2,
    sync,
    env,
    run,
    calls,
    save,
    load,
    advance,
    state: () => state,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("CLI carries the reviewed World base and rejects main advancing before submission or approval", () => {
  const f = fixture();
  try {
    const verdict = join(f.root, "verdict.json");
    f.write("event.json", JSON.stringify({ workflow_run: { id: 123 } }));
    expect(f.run("review-plan").status).toBe(0);
    expect(f.load().issues[0].body).toContain(`upstream-review-base ${f.main}`);
    expect(f.run("local-plan").status).toBe(0);
    expect(
      JSON.parse(
        readFileSync(join(f.root, ".agents/upstream-local/plan.json"), "utf8"),
      ).reviewBase,
    ).toBe(f.main);
    expect(f.run("submit-review", {}, f.root, [verdict]).status).toBe(0);
    expect(
      f.calls().find((call) => call.body?.inputs?.verdict)?.body.inputs.base,
    ).toBe(f.main);
    f.advance();
    const submitted = f.run("submit-review", {}, f.root, [verdict]);
    expect(submitted.status).not.toBe(0);
    expect(submitted.stderr.toString()).toContain("reviewed base");
    // An API snapshot of the PR may still show the old base; current main alone
    // must invalidate the review before it reaches the reviewer identity.
    f.state().pr.base.sha = f.main;
    f.save();
    f.write(
      "event.json",
      JSON.stringify({ inputs: { run_id: "123", head: f.head, base: f.main } }),
    );
    expect(f.run("review-plan").status).not.toBe(0);
    const posted = f.run("post-review", {
      VERDICT: readFileSync(verdict, "utf8"),
    });
    expect(posted.status).not.toBe(0);
    expect(
      f
        .calls()
        .filter((call) => call.args[1]?.endsWith("/reviews") && call.body),
    ).toHaveLength(0);
  } finally {
    f.cleanup();
  }
});

test("CLI refuses obsolete source work before preparation and publication even when all ancestry checks pass", () => {
  const f = fixture();
  try {
    const latest = f.advance(f.source2);
    f.git("checkout", "-qb", "obsolete", latest);
    f.git("merge", "--no-commit", "--no-ff", f.source2);
    f.record(f.source1);
    const stale = f.commit("Obsolete downgrade");
    f.state().head = stale;
    f.state().pr = null;
    f.save();
    f.git("checkout", "main");
    const sync = JSON.stringify({ ...f.sync, head: stale });
    expect(
      f.run("prepare", { SYNC: JSON.stringify({ ...f.sync, head: undefined }) })
        .status,
    ).not.toBe(0);
    const published = f.run("publish-head", {
      SYNC: sync,
      REPORT: "Synthetic integration report with Q41 focused checks.",
    });
    expect(published.status).not.toBe(0);
    expect(published.stderr.toString()).toContain("source baseline");
    expect(
      f.calls().some((call) => call.args[1]?.endsWith("/pulls") && call.body),
    ).toBe(false);
  } finally {
    f.cleanup();
  }
});

test("CLI creates a trusted failure latch despite outsider/PR title collisions and deduplicates valid blockers", () => {
  const f = fixture();
  try {
    f.state().issues = [
      {
        number: 7,
        title: "Upstream automation blocked",
        user: { login: "outsider" },
      },
      {
        number: 8,
        title: "Upstream automation blocked",
        user: { login: actor },
        pull_request: {},
      },
    ];
    f.state().pr = null;
    f.state().actor = "example";
    f.save();
    expect(f.run("block").status).toBe(0);
    expect(f.load().issues).toHaveLength(3);
    expect(f.state().issues.at(-1).user.login).toBe("example");
    expect(f.run("block").status).toBe(0);
    expect(f.load().issues).toHaveLength(3);
    expect(f.run("local-plan").status).not.toBe(0);
    expect(f.run("detect").stdout.toString()).toContain("blocked");
    f.state().issues = [];
    f.state().actor = actor;
    f.save();
    expect(f.run("block", { GITHUB_ACTIONS: "true" }).status).toBe(0);
    expect(f.run("block", { GITHUB_ACTIONS: "true" }).status).toBe(0);
    expect(f.load().issues).toHaveLength(1);
  } finally {
    f.cleanup();
  }
});

test("CLI refuses a local identity whose failure blocker could not stop later runs", () => {
  const f = fixture();
  try {
    f.state().actor = "outside-collaborator";
    f.save();
    expect(f.run("local-plan").status).not.toBe(0);
    expect(f.run("block").status).not.toBe(0);
    expect(f.load().issues).toHaveLength(0);
  } finally {
    f.cleanup();
  }
});

test("CLI transports actual report evidence through export, local dispatch and initial/repair PR publication", () => {
  const f = fixture();
  try {
    f.state().pr = null;
    f.save();
    f.git("merge", "--no-commit", "--no-ff", f.source1);
    f.record(f.source1);
    f.write("CHANGELOG.md", "Integration\n");
    mkdirSync(join(f.root, ".agents/upstream"), { recursive: true });
    f.write(".agents/upstream/start", f.main);
    const report =
      "Q41 checks passed; adapted synthetic feature.\nKnowledge map impact: unchanged — synthetic source ownership is unchanged.\nUnresolved decision: inspect the synthetic platform behavior.\n";
    f.write(".agents/upstream/report.md", report);
    const initial = JSON.stringify({ ...f.sync, head: undefined });
    expect(f.run("export", { SYNC: initial }).status).toBe(0);
    expect(
      readFileSync(join(f.root, ".agents/upstream/export/report.md"), "utf8"),
    ).toBe(report);
    f.git("merge", "--abort");
    expect(f.run("publish-local", { SYNC: initial }).status).toBe(0);
    let dispatch = f
      .calls()
      .filter((call) => call.body?.inputs?.sync)
      .at(-1).body.inputs;
    expect(dispatch.report).toBe(report);
    f.git("checkout", "--detach", f.main);
    expect(
      f.run("publish-head", { SYNC: dispatch.sync, REPORT: dispatch.report })
        .status,
    ).toBe(0);
    expect(f.load().pr.body).toContain(report);
    const oldHead = f.state().head;
    f.git("checkout", "--detach", oldHead);
    f.write("repair.txt", "adaptation repair\n");
    f.write(".agents/upstream/start", oldHead);
    const repairedReport = report.replace(
      "checks passed",
      "repair checks passed",
    );
    f.write(".agents/upstream/report.md", repairedReport);
    const repair = JSON.stringify({
      ...f.sync,
      repair: 1,
      head: oldHead,
      pr: 1,
    });
    expect(f.run("export", { SYNC: repair }).status).toBe(0);
    const publication = join(f.root, ".agents/worktrees/repair");
    f.git("worktree", "add", "--detach", publication, oldHead);
    mkdirSync(join(publication, ".agents/upstream"), { recursive: true });
    cpSync(
      join(f.root, ".agents/upstream/export"),
      join(publication, ".agents/upstream/export"),
      { recursive: true },
    );
    expect(f.run("publish-local", { SYNC: repair }, publication).status).toBe(
      0,
    );
    dispatch = f
      .calls()
      .filter((call) => call.body?.inputs?.sync)
      .at(-1).body.inputs;
    f.git("checkout", "--detach", f.main);
    expect(
      f.run("publish-head", { SYNC: dispatch.sync, REPORT: dispatch.report })
        .status,
    ).toBe(0);
    expect(f.load().pr.body).toContain(repairedReport);
  } finally {
    f.cleanup();
  }
});
