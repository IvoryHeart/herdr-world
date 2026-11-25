import { expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workflow = Bun.YAML.parse(
  readFileSync(".github/workflows/release-pr.yml", "utf8"),
) as any;
const steps = workflow.jobs.prepare.steps;

test("release dispatch uses the CLI's manifest override, including RC promotion and the default bump", () => {
  const prepare = steps.find(
    (step: any) => step.name === "Prepare the release PR",
  );
  expect(prepare).toBeDefined();
  expect(prepare.env.RELEASE_AS).toBe("${{ inputs.release_as }}");
  expect(prepare.env.GH_REPO).toBe("${{ github.repository }}");
  expect(prepare.env.GH_TOKEN).toBe("${{ github.token }}");
  expect(
    steps.some((step: any) => step.uses?.startsWith("actions/checkout@")),
  ).toBe(true);
  expect(
    steps.some((step: any) => step.uses?.startsWith("oven-sh/setup-bun@")),
  ).toBe(true);
  const root = mkdtempSync(join(tmpdir(), "release-pr-"));
  try {
    writeFileSync(
      join(root, "npx"),
      `#!/usr/bin/env node
require('node:fs').writeFileSync(process.env.ARGS_FILE, JSON.stringify(process.argv.slice(2)));
process.exit(Number(process.env.CLI_EXIT || 0));
`,
      { mode: 0o755 },
    );
    const config = readFileSync("release-please-config.json", "utf8");
    const run = (version: string, cliExit = "0") =>
      Bun.spawnSync(["bash", "-euo", "pipefail", "-c", prepare.run], {
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH}`,
          GH_REPO: "example/project",
          GH_TOKEN: "fixture",
          RELEASE_AS: version,
          ARGS_FILE: join(root, "args.json"),
          CLI_EXIT: cliExit,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
    for (const version of ["0.3.8-rc.1", "0.3.8-rc.2", "0.3.8", ""]) {
      expect(run(version).exitCode).toBe(0);
      const args: string[] = JSON.parse(
        readFileSync(join(root, "args.json"), "utf8"),
      );
      expect(args.slice(0, 3)).toEqual([
        "--yes",
        "release-please@17.3.0",
        "release-pr",
      ]);
      const option = (name: string) => args[args.indexOf(name) + 1];
      expect(option("--repo-url")).toBe("example/project");
      expect(option("--target-branch")).toBe("main");
      const manifestConfig = JSON.parse(
        readFileSync(option("--config-file"), "utf8"),
      );
      expect(manifestConfig.packages["."]["release-type"]).toBe("simple");
      expect(manifestConfig.packages["."]["extra-files"]).toContainEqual({
        type: "generic",
        path: "herdr-plugin.toml",
      });
      expect(manifestConfig.packages["."]["release-as"]).toBeUndefined();
      expect(option("--manifest-file")).toBe(".release-please-manifest.json");
      if (version) expect(option("--release-as")).toBe(version);
      else expect(args).not.toContain("--release-as");
      expect(readFileSync("release-please-config.json", "utf8")).toBe(config);
    }
    expect(run("0.3.8-rc.1", "1").exitCode).not.toBe(0);
    for (const invalid of [
      "v0.3.8",
      "0.3.8-rc.0",
      "0.3.8-beta.1",
      "0.3.8\n--dry-run",
      "$(exit 0)",
    ]) {
      rmSync(join(root, "args.json"), { force: true });
      expect(run(invalid).exitCode).not.toBe(0);
      expect(existsSync(join(root, "args.json"))).toBe(false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release PR checks target the same repository's open release branch", () => {
  const step = steps.find(
    (step: any) => step.name === "Dispatch checks for the release-please PR",
  );
  expect(step.if).toBeUndefined();
  const root = mkdtempSync(join(tmpdir(), "release-pr-checks-"));
  try {
    writeFileSync(
      join(root, "gh"),
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'pr') {
  fs.writeFileSync(process.env.FIXTURE + '/query', JSON.stringify(args));
  process.stdout.write(process.env.BRANCH || '');
} else fs.appendFileSync(process.env.FIXTURE + '/dispatches', JSON.stringify(args) + '\\n');
`,
      { mode: 0o755 },
    );
    const run = (branch: string) =>
      Bun.spawnSync(["bash", "-euo", "pipefail", "-c", step.run], {
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH}`,
          FIXTURE: root,
          BRANCH: branch,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
    expect(run("").exitCode).toBe(0);
    expect(existsSync(join(root, "dispatches"))).toBe(false);
    expect(run("release-please--branches--main").exitCode).toBe(0);
    expect(
      readFileSync(join(root, "dispatches"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toEqual([
      ["workflow", "run", "ci.yml", "--ref", "release-please--branches--main"],
      [
        "workflow",
        "run",
        "privacy.yml",
        "--ref",
        "release-please--branches--main",
      ],
    ]);
    const query = JSON.parse(readFileSync(join(root, "query"), "utf8"));
    expect(query).toEqual([
      "pr",
      "list",
      "--state",
      "open",
      "--base",
      "main",
      "--head",
      "release-please--branches--main",
      "--json",
      "headRefName,isCrossRepository",
      "--jq",
      ".[] | select(.isCrossRepository == false) | .headRefName",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
