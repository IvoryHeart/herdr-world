import { expect, test } from "bun:test";
import { worldBrowserShards } from "./world-browser-suites";

type WorkflowStep = {
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  "continue-on-error"?: boolean;
  env?: Record<string, string>;
  with?: { "fetch-depth"?: number; ref?: string };
  "working-directory"?: string;
};

type WorkflowJob = {
  name?: string;
  uses?: string;
  "runs-on"?: string;
  needs?: string | string[];
  if?: string;
  "continue-on-error"?: boolean;
  strategy?: {
    "fail-fast"?: boolean;
    "max-parallel"?: number;
    matrix?: {
      include?: Array<{ arch?: string; runner?: string }>;
      platform?: string[];
      shard?: number[];
      suite?: string[];
      order?: string[];
    };
  };
  steps: WorkflowStep[];
};

const workflow = Bun.YAML.parse(
  await Bun.file(
    new URL("../.github/workflows/ci.yml", import.meta.url),
  ).text(),
) as {
  on: {
    pull_request: { types: string[] };
    workflow_dispatch: {
      inputs: Record<string, { type: string; default: unknown }>;
    };
  };
  permissions: { actions: string };
  concurrency: { "cancel-in-progress": string };
  jobs: Record<string, WorkflowJob>;
};

const worldWorkflow = Bun.YAML.parse(
  await Bun.file(
    new URL("../.github/workflows/world-browser.yml", import.meta.url),
  ).text(),
) as {
  on: Record<string, unknown>;
  permissions: { contents: string };
  jobs: Record<string, WorkflowJob>;
};

test("browser lifecycle comparisons are opt-in and retain both revisions' evidence", () => {
  expect(
    workflow.on.workflow_dispatch.inputs.browser_diagnostics,
  ).toMatchObject({ type: "boolean", default: false });
  const job = workflow.jobs["browser-diagnostics"];
  expect(job.if).toBe(
    "github.event_name == 'workflow_dispatch' && inputs.browser_diagnostics",
  );
  expect(job.strategy?.["fail-fast"]).toBe(false);
  expect(job.strategy?.matrix?.order).toEqual([
    "baseline-first",
    "candidate-first",
  ]);
  expect(job.strategy?.matrix?.suite).toEqual([
    "HostsFilter.creation",
    "SpatialGraphView.browser",
    "useSpacesTabWindowArrangement.browser",
  ]);
  const comparison = job.steps.find(
    (step) => step.name === "Compare revisions on the same runner",
  )!;
  expect(comparison.run).toContain('revisions="baseline candidate"');
  expect(comparison.run).toContain('revisions="candidate baseline"');
  expect(comparison.run).toContain("--parallel=1 --max-concurrency=1");
  expect(comparison.run).toContain("revision_result=$?");
  expect(comparison.run).toContain('exit "$result"');
  expect(comparison["continue-on-error"]).toBeUndefined();
  expect(
    job.steps.find((step) => step.name === "Retain browser lifecycle evidence")
      ?.if,
  ).toBe("always()");
  expect(workflow.jobs.delivery.needs).not.toContain("browser-diagnostics");
});

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
    "behavioral",
    "plugin-windows",
    "installer-upgrade",
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
  expect(workflow.jobs["world-browser"]).toMatchObject({
    needs: "validation-scope",
    if: "needs.validation-scope.outputs.mode == 'full'",
    uses: "./.github/workflows/world-browser.yml",
  });
  expect(Object.keys(worldWorkflow.on)).toEqual(["workflow_call"]);
  expect(worldWorkflow.permissions.contents).toBe("read");
  const world = worldWorkflow.jobs["world-browser"];
  expect(world?.needs).toBeUndefined();
  expect(world?.if).toBeUndefined();
  expect(world?.["continue-on-error"] ?? false).toBe(false);
  for (const step of world?.steps ?? [])
    expect(step["continue-on-error"] ?? false).toBe(false);
  expect(world?.["runs-on"]).toBe("ubuntu-latest");
  expect(world?.strategy?.matrix?.shard).toEqual(
    worldBrowserShards.map((_, index) => index + 1),
  );
  expect(world?.strategy?.["fail-fast"]).toBe(false);
  expect(world?.strategy?.["max-parallel"]).toBe(8);
  expect(
    world?.steps.find(
      (step) =>
        step.run ===
        "bun run test:world --shard=${{ matrix.shard }}/8 --parallel=1 --max-concurrency=1",
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

test("accepted behavioral evidence is an unfiltered protected delivery dependency", async () => {
  const candidate = Bun.YAML.parse(
    await Bun.file(
      new URL(
        "../.github/workflows/behavioral-verification.yml",
        import.meta.url,
      ),
    ).text(),
  ) as {
    on: Record<string, unknown>;
    permissions: Record<string, string>;
    jobs: Record<string, WorkflowJob & { "timeout-minutes": number }>;
  };
  expect(candidate.on.workflow_call).toBeNull();
  expect(candidate.permissions).toEqual({ contents: "read" });
  const job = candidate.jobs.candidate;
  expect(job.if).toBeUndefined();
  expect(job["continue-on-error"]).toBeUndefined();
  expect(job["timeout-minutes"]).toBe(20);
  const verify = job.steps.find(
    (step) => step.run === "bun run verification:resources --system",
  )!;
  expect(verify).toBeDefined();
  expect(verify.if).toBeUndefined();
  expect(verify["continue-on-error"]).toBeUndefined();
  expect(
    job.steps.some((step) => step.run === "bun run verification:setup"),
  ).toBe(true);
  const artifact = job.steps.find(
    (step) => step.name === "Retain source-bound evidence manifests",
  )!;
  expect(artifact.if).toBe("always()");
  expect((artifact.with as { path?: string }).path).toContain(
    ".agents/verification/diagnostics/**",
  );
  expect(
    job.steps.find(
      (step) => step.run === "bun run verification:diagnostic-control",
    )?.["continue-on-error"],
  ).toBeUndefined();
  expect(
    job.steps.some(
      (step) => step.run === "bun run verification:diagnostic-control",
    ),
  ).toBe(true);
  expect(workflow.jobs.delivery.needs).toContain("behavioral");
  expect(workflow.jobs.behavioral.uses).toBe(
    "./.github/workflows/behavioral-verification.yml",
  );
  expect(workflow.jobs.behavioral.if).toBe(
    "needs.validation-scope.outputs.mode != 'reuse'",
  );
  for (const step of workflow.jobs.delivery.steps.filter(
    (step) => step.run === "bun scripts/ci-delivery-result.ts",
  )) {
    expect(step.env?.BEHAVIORAL_RESULT).toBe("${{ needs.behavioral.result }}");
  }
});

test("CI checks native plugin compatibility on Windows and both macOS architectures", () => {
  const windows = workflow.jobs["plugin-windows"];
  expect(windows["runs-on"]).toBe("windows-latest");
  expect(workflow.jobs.delivery.needs).toContain("plugin-windows");
  expect(
    workflow.jobs.delivery.steps.find(
      (step) => step.name === "Require Windows plugin evidence",
    )?.run,
  ).toBe('test "$WINDOWS_PLUGIN_RESULT" = success');
  expect(
    windows.steps.some((step) =>
      step.run?.includes(
        "scripts/install-plugin.windows.test.ts scripts/plugin-native.test.ts server/src/config/plugin-command.test.ts",
      ),
    ),
  ).toBe(true);
  expect(
    workflow.jobs.launchd.steps.some((step) =>
      step.run?.includes("cp server/herdr-world server/herdr-world-plugin.exe"),
    ),
  ).toBe(true);
});
