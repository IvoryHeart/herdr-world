import { expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  dailyDecision,
  reviewedReleasePull,
  stableNotes,
  unreleasedChanges,
  type ReleasePull,
  type Publication,
} from "./daily-release";

const changes =
  "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- A reviewed feature.\n\n### Known issues\n\n- Existing timing issue.\n\n## [0.2.4] - 2026-10-16\n\n- Historical change.\n";
const source =
  "- Roamgate source: v0.8.5, `" +
  "a".repeat(40) +
  "`\n- Herdr compatibility: Herdr 0.9.4, protocol 22.\n";
const pull = (): ReleasePull => ({
  number: 10,
  title: "Release 0.2.5",
  body: '<!-- daily-patch-release {"from":"0.2.4","version":"0.2.5"} -->',
  merged_at: "2026-10-16T12:00:00Z",
  merge_commit_sha: "b".repeat(40),
  user: { login: "github-actions[bot]" },
  base: { ref: "main" },
  head: {
    sha: "c".repeat(40),
    ref: "release/v0.2.5",
    repo: { full_name: "IvoryHeart/herdr-world" },
  },
});

test("daily readiness requires changes, no active PR, and completed publication; only patch increments are generated", () => {
  for (const current of ["0.2.4", "0.2.5", "0.3.0", "1.0.0", "0.2.5-rc.1"]) {
    for (const publication of [
      "missing",
      "pending",
      "success",
      "failure",
      "blocked",
    ] as Publication[]) {
      for (const changes of [true, false])
        for (const openRelease of [true, false]) {
          const decision = dailyDecision({
            current,
            latest: "0.2.4",
            publication,
            changes,
            openRelease,
          });
          if (decision.action === "prepare") {
            expect(current).toBe("0.2.4");
            expect(publication).toBe("success");
            expect(changes).toBe(true);
            expect(openRelease).toBe(false);
            expect(decision.version).toBe("0.2.5");
          }
          if (
            ["pending", "blocked"].includes(publication) ||
            ["0.3.0", "1.0.0", "0.2.5-rc.1"].includes(current)
          )
            expect(decision.action).toBe("none");
        }
    }
  }
  expect(
    dailyDecision({
      current: "0.2.4",
      latest: "0.2.4",
      publication: "failure",
      changes: true,
      openRelease: false,
    }).action,
  ).toBe("publish");
  expect(
    dailyDecision({
      current: "0.2.5",
      latest: "0.2.4",
      publication: "missing",
      changes: true,
      openRelease: false,
    }).action,
  ).toBe("publish");
  expect(() =>
    dailyDecision({
      current: "0.2.4",
      latest: "not-a-version",
      publication: "success",
      changes: true,
      openRelease: false,
    }),
  ).toThrow();
});

test("empty changelogs and standing known issues do not offer a release", () => {
  expect(unreleasedChanges(changes)).toContain("A reviewed feature");
  expect(unreleasedChanges(changes)).not.toContain("Historical change");
  expect(unreleasedChanges(changes)).not.toContain("Existing timing issue");
  expect(
    unreleasedChanges("## [Unreleased]\n\n## [0.2.4] - date\n- Old.\n"),
  ).toBe("");
  expect(
    unreleasedChanges("## [Unreleased]\n### Known issues\n- Timing.\n"),
  ).toBe("");
  expect(() => unreleasedChanges("- Not a changelog")).toThrow();
});

test("automatic publication proves the merged main PR, author and consecutive patch intent", () => {
  expect(
    reviewedReleasePull([pull()], "b".repeat(40), "0.2.5", true).number,
  ).toBe(10);
  for (const mutate of [
    (p: ReleasePull) => {
      p.merged_at = null;
    },
    (p: ReleasePull) => {
      p.merge_commit_sha = "d".repeat(40);
    },
    (p: ReleasePull) => {
      p.base.ref = "other";
    },
    (p: ReleasePull) => {
      p.head.repo = { full_name: "synthetic/fork" };
    },
    (p: ReleasePull) => {
      p.user.login = "synthetic-user";
    },
    (p: ReleasePull) => {
      p.body = "No preparation record";
    },
    (p: ReleasePull) => {
      p.body =
        '<!-- daily-patch-release {"from":"0.1.4","version":"0.2.5"} -->';
    },
    (p: ReleasePull) => {
      p.body =
        '<!-- daily-patch-release {"from":"0.2.4","version":"0.2.6"} -->';
    },
  ]) {
    const candidate = pull();
    mutate(candidate);
    expect(() =>
      reviewedReleasePull([candidate], "b".repeat(40), "0.2.5", true),
    ).toThrow();
  }
  expect(() =>
    reviewedReleasePull([pull(), pull()], "b".repeat(40), "0.2.5", true),
  ).toThrow();
  expect(() =>
    reviewedReleasePull([pull()], "b".repeat(40), "0.2.5-rc.1", true),
  ).toThrow();
});

test("generated notes preserve exact lineage, reviewed changes and unresolved issues", () => {
  const notes = stableNotes(
    "0.2.5",
    unreleasedChanges(changes),
    source,
    "# Known issues\n\n- Timing: issue #202.\n",
  );
  expect(notes).toContain("# Herdr World 0.2.5");
  expect(notes).toContain("a".repeat(40));
  expect(notes).toContain("Herdr 0.9.4");
  expect(notes).toContain("A reviewed feature");
  expect(notes).toContain("issue #202");
  expect(() => stableNotes("0.3.0-rc.1", "- Feature", source, "")).toThrow();
  expect(() => stableNotes("0.2.5", "", source, "")).toThrow();
  expect(() =>
    stableNotes("0.2.5", "- Feature", "Unknown source", ""),
  ).toThrow();
});

// These workflows execute on Ubuntu. Exercise the actual CLI against a real Git
// history and a synthetic GitHub transport, without network writes or credentials.
test.skipIf(process.platform === "win32")(
  "publication and dispatch use reviewed immutable history, preserve tags, and fail closed",
  () => {
    const root = mkdtempSync(join(tmpdir(), "world-daily-release-"));
    const env: Record<string, string | undefined> & {
      GITHUB_OUTPUT: string;
      DAILY_FIXTURE: string;
      DAILY_CALLS: string;
    } = {
      ...process.env,
      HOME: join(root, "home"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GITHUB_OUTPUT: join(root, "outputs"),
      GITHUB_STEP_SUMMARY: join(root, "summary"),
      DAILY_FIXTURE: join(root, "github.json"),
      DAILY_CALLS: join(root, "calls"),
    };
    const run = (args: string[]) => {
      const result = Bun.spawnSync(args, {
        cwd: root,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      if (result.exitCode !== 0) throw new Error(result.stderr.toString());
      return result.stdout.toString().trim();
    };
    const git = (...args: string[]) => run(["git", ...args]);
    try {
      for (const path of ["home", "bin", "web", "server", "docs/releases"])
        mkdirSync(join(root, path), { recursive: true });
      git("init", "--initial-branch=main");
      git("config", "user.name", "Fixture");
      git("config", "user.email", "fixture@example.invalid");
      for (const path of [
        "package.json",
        "web/package.json",
        "server/package.json",
      ])
        writeFileSync(join(root, path), '{"version":"0.0.0"}');
      writeFileSync(join(root, "herdr-plugin.toml"), 'version = "0.2.3"\n');
      git("add", ".");
      git("commit", "-m", "Baseline");
      git("checkout", "-b", "release/v0.2.4");
      writeFileSync(join(root, "herdr-plugin.toml"), 'version = "0.2.4"\n');
      writeFileSync(
        join(root, "docs/releases/v0.2.4.md"),
        "# Reviewed release\n",
      );
      writeFileSync(join(root, "CHANGELOG.md"), changes);
      writeFileSync(join(root, "UPSTREAM.md"), source);
      writeFileSync(
        join(root, "docs/known-issues.md"),
        "# Known issues\n- Preserve this issue.\n",
      );
      git("add", ".");
      git("commit", "-m", "Prepare patch");
      const head = git("rev-parse", "HEAD");
      git("checkout", "main");
      git("merge", "--no-ff", "release/v0.2.4", "-m", "Reviewed release merge");
      const release = git("rev-parse", "HEAD");
      writeFileSync(join(root, "later.txt"), "Later reviewed change");
      git("add", "later.txt");
      git("commit", "-m", "Later main");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      const pr = {
        ...pull(),
        merge_commit_sha: release,
        head: { ...pull().head, sha: head, ref: "release/v0.2.4" },
        body: '<!-- daily-patch-release {"from":"0.2.3","version":"0.2.4"} -->',
      };
      const fixture: any = {
        latest: "v0.2.3",
        pulls: [pr],
        open: [],
        runs: [],
        checks: [{ bucket: "pass" }],
      };
      const fake = join(root, "github.ts");
      writeFileSync(
        fake,
        `import {readFileSync,appendFileSync} from "node:fs"; const a=process.argv.slice(2); appendFileSync(process.env.DAILY_CALLS!,JSON.stringify(a)+"\\n"); const f=JSON.parse(readFileSync(process.env.DAILY_FIXTURE!,"utf8")); let value; if(a[0]==="api"){const p=a[1]!; value=p.endsWith("releases/latest")?{tag_name:f.latest}:p.includes("state=open")?f.open:p.includes("/commits/")?f.pulls:p.includes("release.yml/runs")?{workflow_runs:f.runs}:null; if(value===null) throw new Error(p); if(a.includes("--slurp"))value=[value];}else if(a[0]==="pr")value=f.checks; else if(a[0]==="workflow")value={};else throw new Error(JSON.stringify(a)); console.log(JSON.stringify(value));`,
      );
      const literal = (value: string) =>
        "'" + value.replaceAll("'", "'\\''") + "'";
      writeFileSync(
        join(root, "bin/gh"),
        `#!/bin/sh\nexec ${literal(process.execPath)} ${literal(fake)} "$@"\n`,
      );
      chmodSync(join(root, "bin/gh"), 0o700);
      env.PATH = join(root, "bin") + ":" + process.env.PATH;
      const execute = (mode: string, extra: Record<string, string> = {}) => {
        writeFileSync(env.DAILY_FIXTURE, JSON.stringify(fixture));
        writeFileSync(env.GITHUB_OUTPUT, "");
        writeFileSync(env.DAILY_CALLS, "");
        const result = Bun.spawnSync(
          [process.execPath, join(import.meta.dir, "daily-release.ts"), mode],
          {
            cwd: root,
            env: { ...env, VERSION: "0.2.4", AUTOMATIC: "true", ...extra },
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        return {
          code: result.exitCode,
          outputs: readFileSync(env.GITHUB_OUTPUT, "utf8"),
          calls: readFileSync(env.DAILY_CALLS, "utf8"),
          error: result.stderr.toString(),
        };
      };
      let result = execute("publication");
      expect(result.error).toBe("");
      expect(result.code).toBe(0);
      expect(result.outputs).toContain("mode=tag");
      expect(result.outputs).toContain(`sha=${release}`);
      expect(result.outputs).not.toContain(`sha=${git("rev-parse", "HEAD")}`);
      fixture.pulls[0].head.ref = "release/other";
      expect(execute("publication").code).not.toBe(0);
      fixture.pulls[0].head.ref = "release/v0.2.4";
      fixture.pulls[0].user.login = "synthetic-maintainer";
      expect(execute("publication").outputs).toContain("mode=none");
      expect(execute("publication", { AUTOMATIC: "false" }).outputs).toContain(
        "mode=tag",
      );
      fixture.pulls[0].user.login = "github-actions[bot]";
      fixture.checks = [{ bucket: "pending" }];
      expect(execute("publication").code).not.toBe(0);
      fixture.checks = [{ bucket: "pass" }];
      fixture.pulls[0].merged_at = null;
      expect(execute("publication").code).not.toBe(0);
      fixture.pulls[0].merged_at = "2026-10-16T12:00:00Z";
      git("tag", "v0.2.4", release);
      expect(execute("publication").code).not.toBe(0);
      git("tag", "-d", "v0.2.4");
      git("tag", "-a", "v0.2.4", "-m", "Wrong tag", "HEAD");
      expect(execute("publication").code).not.toBe(0);
      git("tag", "-d", "v0.2.4");
      git("tag", "-a", "v0.2.4", "-m", "Reviewed tag", release);
      result = execute("publication");
      expect(result.code).toBe(0);
      expect(result.outputs).toContain("mode=none");
      fixture.runs = [
        {
          id: 42,
          head_sha: release,
          status: "completed",
          conclusion: "failure",
        },
      ];
      result = execute("publication");
      expect(result.code).toBe(0);
      expect(result.outputs).toContain("mode=retry");
      expect(result.outputs).toContain("run_id=42");
      fixture.runs[0].id = -1;
      expect(execute("publication").code).not.toBe(0);
      fixture.runs[0].id = 42;
      fixture.runs[0].head_sha = "e".repeat(40);
      expect(execute("publication").code).not.toBe(0);
      fixture.runs[0].head_sha = release;
      fixture.runs[0].conclusion = "cancelled";
      expect(execute("publication").outputs).toContain("mode=none");
      fixture.runs[0].conclusion = "success";
      fixture.latest = "v0.2.4";
      expect(execute("dispatch", { PUBLISH_ONLY: "true" }).calls).not.toContain(
        '"workflow"',
      );
      result = execute("dispatch");
      expect(result.code).toBe(0);
      expect(result.calls).toContain('"prepare-release.yml"');
      expect(result.calls).toContain('"version=patch"');
      fixture.open = [{ ...pr, title: "Release 0.2.5" }];
      expect(execute("dispatch").calls).not.toContain('"workflow"');
      fixture.open = [];
      const remote = join(root, "remote.git");
      git("init", "--bare", remote);
      git("remote", "add", "origin", remote);
      result = execute("prepare", { VERSION_INPUT: "patch" });
      expect(result.code).toBe(0);
      expect(result.outputs).toContain("ready=true");
      expect(
        readFileSync(join(root, "docs/releases/v0.2.5.md"), "utf8"),
      ).toContain("Preserve this issue");
      expect(execute("prepare", { VERSION_INPUT: "minor" }).code).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  30_000,
);

test("workflow wiring preserves review gates and restricts the publishing credential to immutable tagging", () => {
  const workflow = (name: string): any =>
    Bun.YAML.parse(
      readFileSync(
        new URL(`../.github/workflows/${name}.yml`, import.meta.url),
        "utf8",
      ),
    );
  const daily = workflow("daily-release");
  expect(daily.on.schedule).toEqual([{ cron: "37 6 * * *" }]);
  expect(daily.on.pull_request).toEqual({
    types: ["closed"],
    branches: ["main"],
  });
  expect(daily.jobs.plan.if).toContain("refs/heads/main");
  expect(daily.jobs.plan.if).toContain("github.event.pull_request.merged");
  expect(daily.jobs.plan.steps.at(-1).env.PUBLISH_ONLY).toContain(
    "github.event_name == 'pull_request'",
  );
  const prepare = workflow("prepare-release");
  const steps = prepare.jobs.prepare.steps;
  const guard = steps.findIndex((step: any) => step.id === "automatic");
  const install = steps.findIndex(
    (step: any) => step.run === "bun install --frozen-lockfile",
  );
  const validate = steps.findIndex(
    (step: any) => step.run === "bun run precommit",
  );
  const create = steps.findIndex(
    (step: any) => step.name === "Create release PR",
  );
  expect(guard).toBeGreaterThan(-1);
  expect(install).toBeGreaterThan(guard);
  expect(validate).toBeGreaterThan(install);
  expect(create).toBeGreaterThan(validate);
  for (const step of steps.slice(install))
    expect(step.if).toContain("steps.automatic.outputs.ready == 'true'");
  expect(steps[create].run).toContain('gh workflow run "CI" --ref "$branch"');
  expect(steps[create].run).not.toContain("gh pr merge");
  const publish = workflow("publish-release");
  expect(publish.jobs.publish.if).toContain("refs/heads/main");
  expect(publish.permissions.contents).toBe("read");
  const tokenSteps = publish.jobs.publish.steps.filter((step: any) =>
    JSON.stringify(step).includes("secrets.RELEASE_AUTOMATION_TOKEN"),
  );
  expect(tokenSteps).toHaveLength(1);
  expect(tokenSteps[0].if).toBe("steps.candidate.outputs.mode == 'tag'");
  expect(tokenSteps[0].run).toContain(
    'git tag -a "$TAG" -m "Herdr World $VERSION" "$RELEASE_SHA"',
  );
  expect(tokenSteps[0].run).not.toContain("gh workflow run");
  expect(
    publish.jobs.publish.steps.find(
      (step: any) => step.if === "steps.candidate.outputs.mode == 'retry'",
    ).run,
  ).toContain("--failed");
});
