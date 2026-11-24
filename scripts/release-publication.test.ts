import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const jobs = (
  Bun.YAML.parse(readFileSync(".github/workflows/release.yml", "utf8")) as any
).jobs;
const command = (job: string, name: string) =>
  jobs[job].steps.find((step: any) => step.name === name).run;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "release-actions-"));
  for (const dir of [
    "bin",
    "candidate/npm",
    "candidate/github",
    "remote",
    "package",
  ])
    mkdirSync(join(root, dir), { recursive: true });
  const env = {
    ...process.env,
    PATH: `${root}/bin:${process.env.PATH}`,
    FIXTURE: root,
    RELEASE_VERSION: "0.3.8-rc.1",
    TAG: "v0.3.8-rc.1",
    GH_REPO: "example/project",
  };
  const run = (script: string, extra: Record<string, string> = {}) =>
    Bun.spawnSync(["bash", "-euc", script], {
      cwd: root,
      env: { ...env, ...extra },
      stdout: "pipe",
      stderr: "pipe",
    });
  writeFileSync(
    join(root, "bin/gh"),
    `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2), root = process.env.FIXTURE;
if(args[0] === 'api') {
  if(process.env.API_FAIL) process.exit(1);
  if(args.some(arg => arg.includes('/commits/'))) console.log(process.env.RELEASE_PRS || '[]');
  else if(args.some(arg => arg.includes('/contents/'))) console.log(Buffer.from('previous Formula').toString('base64'));
  else console.log('v0.3.8-rc.1');
} else if(args[0] === 'label' && args[1] === 'create') {
  fs.appendFileSync(path.join(root,'labels'),JSON.stringify(args)+'\\n');
} else if(args[0] === 'pr' && args[1] === 'edit') {
  if(process.env.EDIT_FAIL) process.exit(1);
  fs.appendFileSync(path.join(root,'edits'),JSON.stringify(args)+'\\n');
} else if(args[0] === 'pr' && args[1] === 'list') {
  const result = require('node:child_process').spawnSync('jq', ['-r', args[args.indexOf('--jq')+1]], {input:process.env.TAP_PRS || '[]',encoding:'utf8'});
  process.stdout.write(result.stdout); process.exit(result.status ?? 1);
} else if(args[1] === 'view') console.log(fs.readdirSync(path.join(root,'remote')).join('\\n'));
else if(args[1] === 'download') {
  const target = args[args.indexOf('--dir')+1];
  for(const name of fs.readdirSync(path.join(root,'remote'))) fs.copyFileSync(path.join(root,'remote',name),path.join(target,name));
} else process.exit(64);
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(root, "bin/npm"),
    `#!/usr/bin/env node
const fs = require('node:fs'), crypto = require('node:crypto'), cp = require('node:child_process'), path = require('node:path');
const args = process.argv.slice(2), root = process.env.FIXTURE, file = path.join(root,'registry.json');
const registry = fs.existsSync(file)? JSON.parse(fs.readFileSync(file)):{};
if(args[0] === 'view') {
  if(process.env.API_FAIL) {console.error('E503');process.exit(1);}
  if(!(args[1] in registry)) {console.error('E404');process.exit(1);}
  console.log(JSON.stringify(registry[args[1]]));
} else if(args[0] === 'publish') {
  if(!args.includes('--provenance') || !args.includes('next')) process.exit(64);
  const manifest = JSON.parse(cp.execFileSync('tar',['-xOf',args[1],'package/package.json']));
  const key = manifest.name+'@'+manifest.version;
  if(process.env.FAIL_PACKAGE && key.includes(process.env.FAIL_PACKAGE)) process.exit(1);
  if(key in registry) {console.error('duplicate publication');process.exit(1);}
  registry[key] = 'sha512-'+crypto.createHash('sha512').update(fs.readFileSync(args[1])).digest('base64');
  fs.writeFileSync(file,JSON.stringify(registry));
  fs.appendFileSync(path.join(root,'published'),key+'\\n');
} else process.exit(64);
`,
    { mode: 0o755 },
  );
  return {
    root,
    run,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("existing GitHub assets must match; missing and network failures never permit drift", () => {
  const f = fixture();
  try {
    const script = command(
      "publish",
      "Refuse changes to existing published bytes",
    );
    writeFileSync(
      join(f.root, "candidate/github/archive.tar.xz"),
      "tested bytes",
    );
    writeFileSync(join(f.root, "remote/archive.tar.xz"), "tested bytes");
    expect(f.run(script).exitCode).toBe(0);
    rmSync(join(f.root, "existing"), { recursive: true });
    writeFileSync(join(f.root, "remote/archive.tar.xz"), "different bytes");
    expect(f.run(script).exitCode).toBe(1);
    rmSync(join(f.root, "existing"), { recursive: true });
    writeFileSync(join(f.root, "remote/unexpected"), "unverified bytes");
    expect(f.run(script).exitCode).toBe(1);
    expect(f.run(script, { API_FAIL: "1" }).exitCode).toBe(1);
  } finally {
    f.cleanup();
  }
});

test("published tags complete only their merged release PR, including retries and the next release", () => {
  const f = fixture();
  try {
    const script = command(
      "release-label",
      "Mark the published release PR as tagged",
    );
    const pull = (
      number: number,
      sha: string,
      label = "autorelease: pending",
    ) => ({
      number,
      merge_commit_sha: sha,
      merged_at: "2026-11-24T00:00:00Z",
      base: { ref: "main" },
      labels: [{ name: label }],
    });
    const run = (
      pulls: unknown[],
      sha = "first",
      extra: Record<string, string> = {},
    ) =>
      f.run(script, {
        RELEASE_PRS: JSON.stringify(pulls),
        TAG_COMMIT: sha,
        ...extra,
      });
    const first = pull(11, "first");
    expect(run([first, pull(12, "second")]).exitCode).toBe(0);
    const edit = JSON.parse(readFileSync(join(f.root, "edits"), "utf8").trim());
    expect(edit).toEqual([
      "pr",
      "edit",
      "11",
      "--add-label",
      "autorelease: tagged",
      "--remove-label",
      "autorelease: pending",
    ]);
    expect(run([pull(11, "first", "autorelease: tagged")]).exitCode).toBe(0);
    expect(run([pull(12, "second")], "second").exitCode).toBe(0);
    const before = readFileSync(join(f.root, "edits"), "utf8");
    for (const pulls of [
      [],
      [pull(11, "another")],
      [pull(11, "first", "unrelated")],
      [{ ...first, merged_at: null }],
      [{ ...first, base: { ref: "other" } }],
      [first, pull(13, "first")],
    ])
      expect(run(pulls).exitCode).not.toBe(0);
    expect(run([first], "first", { API_FAIL: "1" }).exitCode).not.toBe(0);
    expect(run([first], "first", { EDIT_FAIL: "1" }).exitCode).not.toBe(0);
    expect(readFileSync(join(f.root, "edits"), "utf8")).toBe(before);
  } finally {
    f.cleanup();
  }
});

test("release summary rejects skipped publication or label completion and permits retained candidates", () => {
  const f = fixture();
  try {
    const script = command(
      "publication-status",
      "One-line failure and recovery",
    );
    for (const candidate of ["success", "skipped"]) {
      const jobs = Object.fromEntries(
        [
          "validate",
          "candidate",
          "publish",
          "npm-publish",
          "homebrew-pr",
          "release-label",
        ].map((name) => [
          name,
          { result: name === "candidate" ? candidate : "success" },
        ]),
      );
      const run = () =>
        f.run(script, {
          RESULTS: JSON.stringify(jobs),
          GITHUB_STEP_SUMMARY: join(f.root, "summary"),
        });
      expect(run().exitCode).toBe(0);
      for (const name of Object.keys(jobs).filter(
        (name) => name !== "candidate",
      )) {
        for (const result of ["skipped", "failure", "cancelled"]) {
          jobs[name].result = result;
          const failed = run();
          expect(failed.exitCode).toBe(1);
          expect(failed.stdout.toString()).toContain(
            `Release stopped at ${name};`,
          );
        }
        jobs[name].result = "success";
      }
    }
  } finally {
    f.cleanup();
  }
});

test("interrupted npm publication resumes exact tested tarballs and refuses conflicting integrity", () => {
  const f = fixture();
  try {
    const platforms = [
      "linux-x64",
      "linux-arm64",
      "darwin-x64",
      "darwin-arm64",
      "windows-x64",
      "windows-arm64",
      "",
    ];
    for (const platform of platforms) {
      const name = "herdr-world" + (platform ? "-" + platform : "");
      writeFileSync(
        join(f.root, "package/package.json"),
        JSON.stringify({ name: "@ivoryheart/" + name, version: "0.3.8-rc.1" }),
      );
      expect(
        f.run(
          `tar -czf candidate/npm/ivoryheart-${name}-0.3.8-rc.1.tgz package`,
        ).exitCode,
      ).toBe(0);
    }
    const script = command(
      "npm-publish",
      "Publish the tested tarballs, retaining matching existing versions",
    );
    expect(f.run(script, { FAIL_PACKAGE: "darwin" }).exitCode).toBe(1);
    expect(
      readFileSync(join(f.root, "published"), "utf8").trim().split("\n"),
    ).toHaveLength(2);
    expect(f.run(script).exitCode).toBe(0);
    const published = readFileSync(join(f.root, "published"), "utf8");
    expect(new Set(published.trim().split("\n")).size).toBe(7);
    expect(published.trim().split("\n").at(-1)).toBe(
      "@ivoryheart/herdr-world@0.3.8-rc.1",
    );
    expect(f.run(script).exitCode).toBe(0);
    expect(readFileSync(join(f.root, "published"), "utf8")).toBe(published);
    const registry = JSON.parse(
      readFileSync(join(f.root, "registry.json"), "utf8"),
    );
    registry["@ivoryheart/herdr-world-linux-arm64@0.3.8-rc.1"] =
      "sha512-conflict";
    writeFileSync(join(f.root, "registry.json"), JSON.stringify(registry));
    expect(f.run(script).exitCode).toBe(1);
    expect(f.run(script, { API_FAIL: "1" }).exitCode).toBe(1);
  } finally {
    f.cleanup();
  }
});

test("tap recovery reuses only this tap's standard-action proposal, never a fork or unrelated branch", () => {
  const f = fixture();
  try {
    const script = command(
      "homebrew-pr",
      "Find an existing tap proposal or already merged Formula",
    );
    const output = join(f.root, "outputs");
    const inspect = (pulls: unknown[]) => {
      writeFileSync(output, "");
      return f.run(script, {
        GITHUB_OUTPUT: output,
        TAP_PRS: JSON.stringify(pulls),
      });
    };
    const title = "herdr-world-rc 0.3.8-rc.1";
    const branch = "update-herdr-world-rc.rb-123";
    expect(
      inspect([{ title, headRefName: "main", isCrossRepository: true }])
        .exitCode,
    ).toBe(0);
    expect(readFileSync(output, "utf8")).toContain("branch=\n");
    expect(
      inspect([{ title, headRefName: branch, isCrossRepository: false }])
        .exitCode,
    ).toBe(0);
    expect(readFileSync(output, "utf8")).toContain(`branch=${branch}\n`);
    expect(
      inspect([{ title, headRefName: "main", isCrossRepository: false }])
        .exitCode,
    ).toBe(1);
    expect(
      inspect([
        { title, headRefName: branch, isCrossRepository: false },
        {
          title,
          headRefName: "update-herdr-world-rc.rb-456",
          isCrossRepository: false,
        },
      ]).exitCode,
    ).toBe(1);
  } finally {
    f.cleanup();
  }
});
