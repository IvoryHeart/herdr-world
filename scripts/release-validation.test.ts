import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

type Step = {
  name?: string;
  run?: string;
  env?: Record<string, string>;
  "continue-on-error"?: boolean;
};
type Job = {
  uses?: string;
  needs?: string | string[];
  if?: string;
  env?: Record<string, string>;
  "continue-on-error"?: boolean;
  steps?: Step[];
};
type Workflow = {
  env?: Record<string, string>;
  jobs: Record<string, Job>;
};

function readWorkflow(name: string): Workflow {
  return Bun.YAML.parse(
    readFileSync(
      new URL(`../.github/workflows/${name}`, import.meta.url),
      "utf8",
    ),
  ) as Workflow;
}

test.each([
  ["ci.yml", "validation", "bun run check", true],
  ["release.yml", "validate", "bun run precommit", true],
  ["prepare-release.yml", "prepare", "bun run precommit", false],
] as const)(
  "%s uses conservative file concurrency and preserves its World coverage",
  (name, jobName, command, separateWorld) => {
    const workflow = readWorkflow(name);
    const job = workflow.jobs[jobName]!;
    const step = job.steps?.find((step) => step.run === command);
    expect(step).toBeDefined();
    expect(step?.["continue-on-error"] ?? false).toBe(false);
    const env = { ...workflow.env, ...job.env, ...step?.env };
    expect(env.HERDR_TEST_PARALLEL).toBe("1");
    expect(env.HERDR_TEST_MAX_CONCURRENCY).toBe("2");
    if (separateWorld) expect(env.HERDR_TEST_EXCLUDE_WORLD_BROWSER).toBe("1");
    else expect(env.HERDR_TEST_EXCLUDE_WORLD_BROWSER).not.toBe("1");
  },
);

test("PR and release validation call the same World workflow", () => {
  const ci = readWorkflow("ci.yml");
  const release = readWorkflow("release.yml");
  expect(ci.jobs["world-browser"]?.uses).toBe(
    "./.github/workflows/world-browser.yml",
  );
  expect(release.jobs["world-browser"]).toMatchObject({
    uses: ci.jobs["world-browser"]!.uses,
    needs: "validate",
  });
  expect(release.jobs["world-browser"]?.if).toBeUndefined();
});

test("release packaging and publication require repository validation and every World shard", () => {
  const workflow = readWorkflow("release.yml");
  expect(workflow.jobs.package?.needs).toEqual(["validate", "world-browser"]);
  function ancestors(name: string): Set<string> {
    const job = workflow.jobs[name]!;
    expect(job["continue-on-error"] ?? false).toBe(false);
    expect(job.if ?? "").not.toContain("always()");
    const dependencies = [job.needs ?? []].flat();
    return new Set([
      ...dependencies,
      ...dependencies.flatMap((dependency) => [...ancestors(dependency)]),
    ]);
  }
  for (const name of [
    "package",
    "publish",
    "npm-publish",
    "homebrew-pr",
    "deploy-pages",
  ]) {
    const required = ancestors(name);
    expect(required.has("validate")).toBe(true);
    expect(required.has("world-browser")).toBe(true);
  }
});

test("Prepare Release validates the generated working tree before opening its PR", () => {
  const steps = readWorkflow("prepare-release.yml").jobs.prepare!.steps!;
  const prepare = steps.findIndex(
    (step) => step.name === "Prepare release files",
  );
  const validate = steps.findIndex(
    (step) => step.name === "Validate prepared release",
  );
  const publish = steps.findIndex((step) => step.name === "Create release PR");
  expect(prepare).toBeGreaterThan(-1);
  expect(validate).toBeGreaterThan(prepare);
  expect(publish).toBeGreaterThan(validate);
});
