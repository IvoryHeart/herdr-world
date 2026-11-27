import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
type Job = {
  name?: string;
  "runs-on"?: string;
  uses?: string;
  needs?: string | string[];
  if?: string;
  env?: Record<string, string>;
  steps?: Array<{
    uses?: string;
    run?: string;
    env?: Record<string, string>;
    with?: { ref?: string };
  }>;
};
const workflow = (name: string) =>
  Bun.YAML.parse(
    readFileSync(join(root, ".github/workflows", name), "utf8"),
  ) as { on: Record<string, unknown>; jobs: Record<string, Job> };

test("merge queue runs the protected Linux delivery graph on the queue commit", () => {
  const ci = workflow("ci.yml");
  expect(ci.on.merge_group).toEqual({ types: ["checks_requested"] });
  expect(ci.jobs.delivery.name).toBe("Delivery checks");
  expect(ci.jobs.delivery.needs).toEqual([
    "validation-scope",
    "static",
    "unit-tests",
    "world-browser",
    "behavioral",
  ]);
  expect(ci.jobs["validation-scope"].if).toStartWith(
    "github.event_name != 'pull_request' ||",
  );
  const visit = (job: Job) => {
    if (job.uses) {
      const reusable = workflow(job.uses.replace("./.github/workflows/", ""));
      expect(reusable.on).toHaveProperty("workflow_call");
      for (const child of Object.values(reusable.jobs)) visit(child);
      return;
    }
    expect(job["runs-on"]).toMatch(/^ubuntu-(?:latest|24\.04)$/);
    for (const step of job.steps ?? []) {
      if (step.uses?.startsWith("actions/checkout@")) {
        // checkout defaults to the event SHA; explicit refs must do the same.
        expect([undefined, "${{ github.sha }}"]).toContain(step.with?.ref);
      }
    }
  };
  for (const [name, job] of Object.entries(ci.jobs)) {
    if (name === "browser-diagnostics" || name.endsWith("-preview")) {
      expect(job.if).toStartWith(
        `github.event_name == '${name.endsWith("-preview") ? "pull_request" : "workflow_dispatch"}'`,
      );
    } else visit(job);
  }
  expect(ci.jobs.static.env?.HERDR_WORLD_RATCHET_TARGET).toBe(
    "${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha }}",
  );
});

test("only CI receives merge groups; side workflows keep their existing events", () => {
  for (const file of readdirSync(join(root, ".github/workflows"))) {
    if (!file.endsWith(".yml") || file === "ci.yml") continue;
    expect(workflow(file).on, file).not.toHaveProperty("merge_group");
  }
});

test("a merge group selects fresh full checks without reading green PR evidence", () => {
  const directory = mkdtempSync(join(tmpdir(), "queue-scope-"));
  try {
    const output = join(directory, "outputs");
    const queried = join(directory, "queried");
    const preload = join(directory, "no-reuse.ts");
    writeFileSync(
      preload,
      `import { writeFileSync } from "node:fs";
globalThis.fetch = async () => {
  writeFileSync(${JSON.stringify(queried)}, "queried prior evidence");
  return Response.json({workflow_runs: []});
};`,
    );
    const scope = workflow("ci.yml").jobs["validation-scope"].steps!.find(
      (step) => step.run?.includes("ci-reuse-full-check.ts"),
    )!;
    const result = spawnSync(
      process.execPath,
      ["--preload", preload, "scripts/ci-reuse-full-check.ts"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          ...scope.env,
          GITHUB_EVENT_NAME: "merge_group",
          GITHUB_REF: "refs/heads/gh-readonly-queue/main/pr-42-example",
          GITHUB_SHA: "c".repeat(40),
          GITHUB_OUTPUT: output,
          GITHUB_REPOSITORY: "example/project",
          GITHUB_TOKEN: "synthetic-test-token",
          GITHUB_RUN_ID: "123",
          PR_NUMBER: "42",
          PR_ACTION: "synchronize",
          PR_BASE_SHA: "a".repeat(40),
          PR_HEAD_SHA: "b".repeat(40),
        },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(queried)).toBe(false);
    const fields = Object.fromEntries(
      readFileSync(output, "utf8")
        .trim()
        .split("\n")
        .map((line) => [
          line.slice(0, line.indexOf("=")),
          line.slice(line.indexOf("=") + 1),
        ]),
    );
    expect(fields).toMatchObject({
      mode: "full",
      world: "true",
      verification: "true",
      packaging: "false",
    });
    expect(JSON.parse(fields.selection!).full).toBe(true);
    expect(result.stdout).toContain("Delivery checks: full validation");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
