import { expect, test } from "bun:test";
import { worldBrowserShards } from "./world-browser-suites";

type WorkflowStep = {
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  env?: Record<string, string>;
  with?: { "fetch-depth"?: number; ref?: string };
};

type WorkflowJob = {
  name?: string;
  "runs-on"?: string;
  needs?: string | string[];
  if?: string;
  strategy?: {
    "fail-fast"?: boolean;
    "max-parallel"?: number;
    matrix?: {
      include?: Array<{ arch?: string; runner?: string }>;
      platform?: string[];
      shard?: number[];
    };
  };
  steps: WorkflowStep[];
};

const workflow = Bun.YAML.parse(
  await Bun.file(
    new URL("../.github/workflows/ci.yml", import.meta.url),
  ).text(),
) as {
  on: { pull_request: { types: string[] } };
  permissions: { actions: string };
  concurrency: { "cancel-in-progress": string };
  jobs: Record<string, WorkflowJob>;
};

test("CI exposes the protected delivery gate and runs the complete repository check", () => {
  expect(workflow.on.pull_request.types).toEqual([
    "opened",
    "synchronize",
    "reopened",
    "edited",
    "labeled",
  ]);
  expect(workflow.permissions.actions).toBe("read");
  expect(workflow.concurrency["cancel-in-progress"]).toContain(
    "github.event.action != 'edited'",
  );
  const delivery = workflow.jobs.delivery;

  expect(delivery?.name).toBe("Delivery checks");
  expect(delivery?.needs).toEqual([
    "validation-scope",
    "validation",
    "world-browser",
  ]);
  expect(delivery?.if).toBe("always()");
  expect(
    delivery?.steps.find((step) => step.name === "Run full repository check"),
  ).toMatchObject({
    if: "needs.validation-scope.outputs.mode == 'full'",
    run: "bun scripts/ci-delivery-result.ts",
    env: {
      VALIDATION_MODE: "full",
      SCOPE_RESULT: "${{ needs.validation-scope.result }}",
      VALIDATION_RESULT: "${{ needs.validation.result }}",
      WORLD_RESULT: "${{ needs.world-browser.result }}",
    },
  });
  const validation = workflow.jobs.validation;
  expect(validation?.needs).toBe("validation-scope");
  expect(
    validation?.steps.find((step) => step.run === "bun run check"),
  ).toMatchObject({
    if: "needs.validation-scope.outputs.mode == 'full'",
    env: {
      HERDR_TEST_EXCLUDE_WORLD_BROWSER: "1",
      HERDR_TEST_PARALLEL: "1",
      HERDR_TEST_MAX_CONCURRENCY: "2",
    },
  });
  expect(
    validation?.steps.find((step) => step.run === "bun run check:docs")?.if,
  ).toBe("needs.validation-scope.outputs.mode == 'docs'");
  const scope = workflow.jobs["validation-scope"];
  expect(
    scope?.steps.find((step) => step.name === "Determine validation scope"),
  ).toMatchObject({
    run: "bun scripts/ci-reuse-full-check.ts",
    env: {
      REQUIRED_JOB_NAME: "Delivery checks",
      REQUIRED_FULL_STEP: "Run full repository check",
    },
  });
  expect(
    scope?.steps.find((step) => step.name === "Check knowledge-map impact"),
  ).toMatchObject({
    if: "github.event_name == 'pull_request'",
    run: 'bun scripts/check-knowledge-map.ts "$GITHUB_EVENT_PATH"',
  });
  expect(
    scope?.steps.find((step) => step.uses?.startsWith("actions/checkout@"))
      ?.with?.["fetch-depth"],
  ).toBe(0);
  expect(workflow.jobs.validate).toBeUndefined();
});

test("all eight World browser shards run independently and retain failure evidence", () => {
  const world = workflow.jobs["world-browser"];
  expect(world?.needs).toBe("validation-scope");
  expect(world?.if).toBe("needs.validation-scope.outputs.mode == 'full'");
  expect(world?.["runs-on"]).toBe("ubuntu-latest");
  expect(world?.strategy?.matrix?.shard).toEqual(
    worldBrowserShards.map((_, index) => index + 1),
  );
  expect(world?.strategy?.["fail-fast"]).toBe(false);
  expect(world?.strategy?.["max-parallel"]).toBe(8);
  expect(
    world?.steps.find(
      (step) => step.run === "bun run test:world --shard=${{ matrix.shard }}/8",
    ),
  ).toMatchObject({
    env: {
      WORLD_TRACE_PREFIX: ".agents/delivery/world-production",
      WORLD_TIMINGS_ONLY: "1",
    },
  });
  expect(
    world?.steps.find((step) =>
      step.uses?.startsWith("actions/upload-artifact@"),
    ),
  ).toMatchObject({
    if: "always()",
    with: {
      path: expect.stringContaining(
        ".agents/delivery/world-production-*-inputs.json",
      ),
    },
  });
});

test("labeled release PRs offer six downloadable previews without publishing", () => {
  const preview = workflow.jobs["release-preview"];
  expect(preview?.strategy?.matrix?.platform).toEqual([
    "linux-x64",
    "linux-arm64",
    "darwin-x64",
    "darwin-arm64",
    "windows-x64",
    "windows-arm64",
  ]);
  expect(
    preview?.steps.find((step) => step.uses?.startsWith("actions/checkout@"))
      ?.with?.ref,
  ).toBe("${{ github.event.pull_request.head.sha }}");
  expect(
    preview?.steps.some((step) =>
      step.run?.includes("package:${{ matrix.platform }}"),
    ),
  ).toBe(true);
  expect(
    preview?.steps.some((step) =>
      step.uses?.includes("actions/upload-artifact"),
    ),
  ).toBe(true);
  expect(preview?.steps.some((step) => step.run?.includes("gh release"))).toBe(
    false,
  );
  const npmPreview = workflow.jobs["npm-preview"];
  expect(
    npmPreview?.steps.some((step) =>
      step.run?.includes("scripts/stage-npm-release.ts"),
    ),
  ).toBe(true);
  expect(
    npmPreview?.steps.some((step) =>
      step.uses?.includes("actions/upload-artifact"),
    ),
  ).toBe(true);
});

test("CI exercises the real plugin-managed launchd lifecycle on both protected architectures", () => {
  const launchd = workflow.jobs.launchd;
  const lifecycle = launchd?.steps.find(
    (step) =>
      step.name === "Exercise the real plugin-managed launchd lifecycle",
  )?.run;

  expect(launchd?.name).toBe(
    "macOS launchd plugin lifecycle (${{ matrix.arch }})",
  );
  expect(launchd?.strategy?.matrix?.include).toEqual([
    { arch: "arm64", runner: "macos-15" },
    { arch: "x86_64", runner: "macos-15-intel" },
  ]);
  expect(
    launchd?.steps.some(
      (step) => step.run === "bun scripts/world-plugin.ts compile-launcher",
    ),
  ).toBe(true);
  expect(lifecycle).toContain('PATH=/usr/bin:/bin "$plugin_launcher" start');
  expect(lifecycle).toContain('PATH=/usr/bin:/bin "$plugin_launcher" status');
  expect(lifecycle).toContain('PATH=/usr/bin:/bin "$plugin_launcher" restart');
  expect(lifecycle).toContain(
    'PATH=/usr/bin:/bin "$plugin_launcher" uninstall',
  );
  expect(lifecycle).toContain("http://127.0.0.1:8787/healthz");
  expect(lifecycle).toContain("trap cleanup EXIT");
  expect(
    launchd?.steps.find(
      (step) =>
        step.name === "Exercise the real plugin-managed launchd lifecycle",
    )?.if,
  ).toBe(
    "steps.scope.outputs.mode != 'docs' && steps.scope.outputs.mode != 'reuse'",
  );
  expect(
    launchd?.steps.find((step) => step.name === "Determine validation scope")
      ?.run,
  ).toBe("bun scripts/ci-reuse-full-check.ts");
});
