import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isReleaseWalkInput } from "./validation-scope";

test("release walk fixture, recorder and receipt regressions pass", () => {
  const result = Bun.spawnSync(
    [
      "python3",
      "-m",
      "unittest",
      "discover",
      "-s",
      "scripts/release-walk",
      "-p",
      "*_test.py",
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  expect(result.stderr.toString()).toContain("Ran 17 tests");
  expect(result.exitCode).toBe(0);
});

test("request builders and walk implementation select native release acceptance", () => {
  for (const path of [
    "web/src/connectionProfiles.ts",
    "web/src/coreConnections.ts",
    "web/src/agentLauncher.ts",
    "web/src/components/ConnectionSwitcher.tsx",
    "web/src/world/agentProfiles.ts",
    "web/src/world/coreControl.ts",
    "web/src/world/town/useTownRoomActions.tsx",
    "web/src/creationRequests.ts",
    "web/src/api.ts",
    "scripts/release-walk.ts",
    "scripts/release-walk/journeys.py",
    "scripts/release-walk-gate.ts",
  ])
    expect(isReleaseWalkInput(path)).toBe(true);
  for (const path of ["docs/release.md", "web/src/world/town/colors.ts"])
    expect(isReleaseWalkInput(path)).toBe(false);
});

function workflow(name: string): any {
  return Bun.YAML.parse(readFileSync(`.github/workflows/${name}.yml`, "utf8"));
}

test("required native workflow runs every release walk without tolerating failure", () => {
  expect(workflow("installer-upgrade").jobs["release-walk"].uses).toBe(
    "./.github/workflows/release-walk.yml",
  );
  const job = workflow("release-walk").jobs.walk;
  expect(job.strategy.matrix.include.map((row: any) => row.platform)).toEqual([
    "linux-x64",
    "linux-arm64",
    "darwin-x64",
    "darwin-arm64",
  ]);
  const step = job.steps.find((step: any) =>
    step.run?.includes("bun run test:release-walk"),
  );
  expect(step.if).toBeUndefined();
  expect(step["continue-on-error"]).toBeUndefined();
  expect(step.run).toContain("--disposable-host");
  const retained = job.steps.find(
    (step: any) =>
      step.with?.name === "release-walk-package-${{ matrix.platform }}",
  );
  expect(retained.if).toBeUndefined();
});

test("tag creation follows exact-revision walk approval; publication reuses tested Unix bytes", () => {
  const publish = workflow("publish-release").jobs.publish.steps;
  const tag = publish.find((step: any) => step.id === "authorize")
    .run as string;
  expect(tag.indexOf("release-walk-gate.ts authorize")).toBeGreaterThan(0);
  const approval = publish.findIndex((step: any) => step.id === "authorize");
  const retain = publish.findIndex(
    (step: any) => step.with?.name === "release-walk-authorization",
  );
  const create = publish.findIndex((step: any) =>
    step.run?.includes("git tag -a"),
  );
  expect(retain).toBeGreaterThan(approval);
  expect(create).toBeGreaterThan(retain);
  expect(publish[create].if).toBe("inputs.create_tag");
  expect(
    workflow("publish-release").on.workflow_dispatch.inputs.create_tag.default,
  ).toBe(false);
  const release = workflow("release");
  const gate = release.jobs.validate.steps.find(
    (step: any) => step.id === "walk",
  );
  expect(gate.run).toContain("release-walk-gate.ts publication");
  expect(gate.if).toBeUndefined();
  const steps = release.jobs.package.steps;
  const build = steps.find(
    (step: any) => step.name === "Build release package",
  );
  expect(build.if).toBe("startsWith(matrix.platform, 'windows-')");
  const reuse = steps.find(
    (step: any) =>
      step.with?.name === "release-walk-package-${{ matrix.platform }}",
  );
  expect(reuse.with["run-id"]).toBe(
    "${{ needs.validate.outputs.walk_run_id }}",
  );
});
