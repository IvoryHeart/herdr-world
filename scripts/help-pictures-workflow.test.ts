import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Step = {
  name?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
};
const workflow = Bun.YAML.parse(
  readFileSync(
    new URL("../.github/workflows/help-pictures.yml", import.meta.url),
    "utf8",
  ),
) as {
  on: { push: unknown };
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: { refresh: { if: string; steps: Step[] } };
};
const steps = workflow.jobs.refresh.steps;

// Execute the actual workflow shell with external commands replaced by fixtures.
// Capture/check failures must stop before a push; no browser or GitHub is contacted.
function run(
  options: {
    fresh?: boolean;
    pr?: string;
    fail?: string;
    noDiff?: boolean;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "help-workflow-"));
  const log = join(directory, "commands");
  try {
    const stubs = {
      bun: `printf 'bun %s\n' "$*" >> "$COMMAND_LOG"
if [ "$2" = "$FAIL_COMMAND" ]; then exit 1; fi
if [ "$2" = help:pictures ]; then touch "$RUNNER_TEMP/captured"; fi
if [ "$2" = help:check ] && [ "$FRESH" != 1 ] && [ ! -f "$RUNNER_TEMP/captured" ]; then exit 1; fi`,
      git: `printf 'git %s\n' "$*" >> "$COMMAND_LOG"
if [ "$1 $2" = 'diff --cached' ]; then [ "$NO_DIFF" = 1 ]; fi`,
      gh: `printf 'gh %s\n' "$*" >> "$COMMAND_LOG"
if [ "$1 $2" = 'pr list' ]; then printf '%s' "$EXISTING_PR"; fi`,
      "google-chrome": "exit 0",
    };
    for (const [name, script] of Object.entries(stubs))
      writeFileSync(join(directory, name), `#!/bin/bash\n${script}\n`, {
        mode: 0o755,
      });
    let status = 0;
    for (const step of steps) {
      if (!step.run || step.run === "bun install --frozen-lockfile") continue;
      if (
        step.if &&
        !readFileSync(join(directory, "outputs"), "utf8").includes(
          "refresh=true",
        )
      )
        continue;
      const result = spawnSync(
        "bash",
        ["-e", "-o", "pipefail", "-c", step.run],
        {
          cwd: directory,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${directory}:${process.env.PATH}`,
            COMMAND_LOG: log,
            RUNNER_TEMP: directory,
            GITHUB_OUTPUT: join(directory, "outputs"),
            FRESH: options.fresh ? "1" : "0",
            EXISTING_PR: options.pr ?? "",
            FAIL_COMMAND: options.fail ?? "",
            NO_DIFF: options.noDiff ? "1" : "0",
          },
        },
      );
      status = result.status ?? 1;
      if (status) break;
    }
    return {
      status,
      commands: readFileSync(log, "utf8"),
      body: existsSync(join(directory, "help-pictures-pr.md"))
        ? readFileSync(join(directory, "help-pictures-pr.md"), "utf8")
        : "",
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("fresh main does no capture or publication, and refresh is serialized on main", () => {
  expect(workflow.on.push).toEqual({ branches: ["main"] });
  expect(workflow.jobs.refresh.if).toBe("github.ref == 'refs/heads/main'");
  expect(workflow.concurrency).toEqual({
    group: "help-pictures",
    "cancel-in-progress": false,
  });
  expect(steps[0]!.with).toMatchObject({
    ref: "main",
    "fetch-depth": 0,
    "persist-credentials": false,
  });
  expect(run({ fresh: true })).toEqual({
    status: 0,
    commands: "bun run help:check --strict\n",
    body: "",
  });
});

test("stale main refreshes only allowed assets and opens or updates one labelled PR", () => {
  for (const pr of ["", "42"]) {
    const result = run({ pr });
    expect(result.status).toBe(0);
    expect(result.commands).toContain(
      "bun run help:pictures\nbun run help:docs\nbun run help:check --strict",
    );
    expect(result.commands).toContain(
      "git add -A web/public/help/ web/src/help/pictures.json docs/HELP.md\n",
    );
    expect(result.commands).toContain(
      "git push --force-with-lease origin HEAD:refs/heads/bot/help-pictures\n",
    );
    expect(result.commands).not.toMatch(/git push[^\n]*refs\/heads\/main/);
    expect(result.commands).toContain(
      pr
        ? "gh pr edit 42"
        : "gh pr create --head bot/help-pictures --base main",
    );
    expect(result.commands).not.toContain(pr ? "gh pr create" : "gh pr edit");
    expect(result.commands).toContain(
      pr
        ? "--add-label help-pictures,auto-merge,skip-changelog"
        : "--label help-pictures --label auto-merge --label skip-changelog",
    );
    for (const check of ["ci.yml", "privacy.yml"])
      expect(result.commands).toContain(
        `gh workflow run ${check} --ref bot/help-pictures`,
      );
    expect(result.commands.indexOf("bun run check:privacy")).toBeLessThan(
      result.commands.indexOf("git push"),
    );
    expect(result.commands).toContain("bun run check:pr-body");
    expect(result.body).toContain("Spec impact: none —");
    expect(result.body).toContain("Verification impact: none —");
  }
});

test("capture and privacy failures prevent publication; an empty refresh does not push", () => {
  for (const fail of ["help:pictures", "check:privacy"]) {
    const result = run({ fail });
    expect(result.status).toBe(1);
    expect(result.commands).not.toContain("git push");
    expect(result.commands).not.toContain("gh pr");
  }
  const empty = run({ noDiff: true });
  expect(empty.status).toBe(0);
  expect(empty.commands).not.toContain("git commit");
  expect(empty.commands).not.toContain("git push");
});
