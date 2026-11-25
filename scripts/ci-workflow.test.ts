import { expect, test } from "bun:test";
import {
  worldBrowserShards,
  worldLatencyTrendSuites,
} from "./world-browser-suites";

type WorkflowStep = {
  id?: string;
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
  "timeout-minutes"?: number | string;
  uses?: string;
  "runs-on"?: string;
  needs?: string | string[];
  if?: string;
  with?: Record<string, string>;
  "continue-on-error"?: boolean;
  strategy?: {
    "fail-fast"?: boolean;
    "max-parallel"?: number;
    matrix?: {
      include?: Array<{ arch?: string; runner?: string }>;
      platform?: string[];
      shard?: number[] | string;
      arch?: string[];
      suite?: string[];
      suites?: string[];
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
    push: { branches: string[] };
    workflow_dispatch: {
      inputs: Record<string, { type: string; default: unknown }>;
    };
  };
  permissions: { actions: string };
  concurrency: { group: string; "cancel-in-progress": string };
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

test("World stability label selects fresh full evidence and three consecutive passes", () => {
  const requested =
    "${{ contains(github.event.pull_request.labels.*.name, 'world-browser-stability') }}";
  expect(workflow.jobs["world-browser"].with?.stability).toBe(requested);
  expect(
    workflow.jobs["validation-scope"].steps.find((step) => step.id === "scope")
      ?.env?.WORLD_BROWSER_STABILITY,
  ).toBe(requested);
  const job = worldWorkflow.jobs["world-browser"];
  expect(job["timeout-minutes"]).toBe("${{ inputs.stability && 45 || 15 }}");
  expect(
    job.steps.find((step) => step.name === "Run World browser shard")?.env
      ?.HERDR_CI_WORLD_RUNS,
  ).toBe("${{ inputs.stability && '3' || '1' }}");
});

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
    "BoardView",
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
  expect(workflow.concurrency["cancel-in-progress"]).toContain(
    "github.event.action != 'labeled'",
  );
  // Post-merge gate: main pushes share one group that never cancels the
  // running check, so a batch of merges is tested once at its newest commit.
  expect(workflow.on.push).toEqual({ branches: ["main"] });
  expect(workflow.concurrency.group).toContain(
    "(github.event_name == 'push' && 'main-push')",
  );
  expect(workflow.concurrency["cancel-in-progress"]).toContain(
    "github.event_name == 'pull_request'",
  );
  const delivery = workflow.jobs.delivery;

  expect(delivery?.name).toBe("Delivery checks");
  expect(delivery?.needs).toEqual([
    "validation-scope",
    "validation",
    "world-browser",
    "behavioral",
    "installer-upgrade",
    "launchd",
    "dependency-security",
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
  expect(workflow.jobs.validation.needs).toEqual([
    "validation-scope",
    "static",
    "unit-tests",
  ]);
  expect(workflow.jobs["world-browser"].needs).toBe("validation-scope");
  expect(workflow.jobs["unit-tests"].strategy?.matrix?.shard).toEqual([1, 2]);
  expect(workflow.jobs["unit-tests"].strategy?.["fail-fast"]).toBe(false);
  expect(workflow.jobs["unit-tests"].needs).toBe("validation-scope");
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
    scope?.steps.find((step) => step.name === "Check PR description"),
  ).toMatchObject({
    if: "github.event_name == 'pull_request'",
    run: 'bun run check:pr-body --event "$GITHUB_EVENT_PATH"',
  });
  expect(
    scope?.steps.find((step) => step.uses?.startsWith("actions/checkout@"))
      ?.with?.["fetch-depth"],
  ).toBe(0);
  expect(workflow.jobs.validate).toBeUndefined();
});

test("no timing gates delivery: browser jobs use the pinned Chrome and never retry", () => {
  expect(worldWorkflow.jobs["latency-shards"]).toBeUndefined();
  expect(worldWorkflow.jobs["world-latency"]).toBeUndefined();
  expect(JSON.stringify(worldWorkflow)).not.toContain("--retry");
  expect(JSON.stringify(worldWorkflow)).not.toContain("latency");
  for (const name of ["world-browser", "web-shards"]) {
    const runs = worldWorkflow.jobs[name]!.steps.flatMap((step) =>
      step.run ? [step.run] : [],
    );
    const chrome = runs.indexOf(
      'bun scripts/test-chrome.ts "$HOME/.cache/herdr-test-chrome"',
    );
    expect(chrome).toBeGreaterThan(-1);
    expect(chrome).toBeLessThan(
      runs.findIndex((run) => run.startsWith("bun scripts/ci-tests.ts")),
    );
  }
});

test("the latency trend measures the trend suites on quiet runners and reports without gating", async () => {
  const trend = Bun.YAML.parse(
    await Bun.file(
      new URL("../.github/workflows/world-latency-trend.yml", import.meta.url),
    ).text(),
  ) as {
    on: Record<string, unknown>;
    permissions: Record<string, string>;
    jobs: Record<string, WorkflowJob>;
  };
  expect(Object.keys(trend.on).sort()).toEqual([
    "pull_request",
    "push",
    "schedule",
    "workflow_dispatch",
  ]);
  expect(trend.permissions).toEqual({ contents: "read", actions: "read" });
  const measure = trend.jobs.measure!;
  expect(
    (measure.strategy?.matrix?.suites ?? [])
      .flatMap((pair) => pair.split(" "))
      .map((suite) => `web/src/world/${suite}.test.ts`)
      .sort(),
  ).toEqual([...worldLatencyTrendSuites].sort());
  expect(measure.strategy?.matrix?.suites).toHaveLength(2);
  const runs = measure.steps.flatMap((step) => (step.run ? [step.run] : []));
  const measured = runs.find((run) =>
    run.includes("for suite in $WORLD_LATENCY_SUITES"),
  )!;
  expect(measured).toContain("bun scripts/wait-for-quiet.ts");
  expect(measured.indexOf("bun scripts/wait-for-quiet.ts")).toBeLessThan(
    measured.indexOf("bun scripts/run-world-tests.ts"),
  );
  expect(measured).toContain("--parallel=1 --max-concurrency=1");
  expect(measured).toContain("latency/$suite.jsonl");
  expect(JSON.stringify(trend)).not.toContain("--retry");
  // Nothing required waits on it.
  expect(JSON.stringify(workflow)).not.toContain("world-latency-trend");
});

test("all World browser shards and the web browser suites run independently and retain failure evidence", () => {
  expect(workflow.jobs["world-browser"]).toMatchObject({
    needs: "validation-scope",
    if: "needs.validation-scope.outputs.world == 'true'",
    uses: "./.github/workflows/world-browser.yml",
  });
  expect(Object.keys(worldWorkflow.on)).toEqual(["workflow_call"]);
  expect(worldWorkflow.permissions.contents).toBe("read");
  const world = worldWorkflow.jobs["world-browser"];
  expect(world?.needs).toBeUndefined();
  expect(world?.if).toBe("toJSON(fromJSON(inputs.selection).world) != '[]'");
  expect(world?.["continue-on-error"] ?? false).toBe(false);
  for (const step of world?.steps ?? [])
    expect(step["continue-on-error"] ?? false).toBe(false);
  expect(world?.["runs-on"]).toBe("ubuntu-latest");
  expect(world?.strategy?.matrix?.shard).toBe(
    "${{ fromJSON(inputs.selection).worldShards }}",
  );
  expect(world?.strategy?.["fail-fast"]).toBe(false);
  expect(world?.strategy?.["max-parallel"]).toBe(worldBrowserShards.length);
  expect(
    world?.steps.find(
      (step) =>
        step.run === "bun scripts/ci-tests.ts world ${{ matrix.shard }}",
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
  const web = worldWorkflow.jobs["web-shards"];
  expect(web?.needs).toBeUndefined();
  expect(web?.if).toBe("toJSON(fromJSON(inputs.selection).web) != '[]'");
  expect(web?.strategy?.matrix?.shard).toEqual([1, 2]);
  expect(worldWorkflow.jobs["web-browser"].needs).toBe("web-shards");
  for (const step of web?.steps ?? [])
    expect(step["continue-on-error"] ?? false).toBe(false);
  expect(
    web?.steps.find(
      (step) =>
        step.run === "bun scripts/ci-tests.ts web ${{ matrix.shard }}/2",
    ),
  ).toMatchObject({
    run: "bun scripts/ci-tests.ts web ${{ matrix.shard }}/2",
    env: { HERDR_TEST_PARALLEL: "2", HERDR_TEST_MAX_CONCURRENCY: "2" },
  });
  expect(
    web?.steps.find((step) =>
      step.uses?.startsWith("actions/upload-artifact@"),
    ),
  ).toMatchObject({ if: "always()" });
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

test("protected launchd reports require native work on the existing installer runners", async () => {
  const launchd = workflow.jobs.launchd;
  expect(launchd.name).toBe(
    "macOS launchd plugin lifecycle (${{ matrix.arch }})",
  );
  expect(launchd["runs-on"]).toBe("ubuntu-latest");
  expect(launchd.needs).toEqual(["validation-scope", "installer-upgrade"]);
  expect(launchd.if).toBe("always()");
  expect(launchd.strategy?.matrix?.arch).toEqual(["arm64", "x86_64"]);
  const report = launchd.steps[0]!;
  expect(report.run).toContain('test "$SCOPE_RESULT" = success');
  expect(report.run).toContain(
    'if [ "$PACKAGING" = true ]; then expected=success; fi',
  );
  expect(report.run).toContain('test "$INSTALLER_RESULT" = "$expected"');
  expect(report.env?.INSTALLER_RESULT).toBe(
    "${{ needs.installer-upgrade.result }}",
  );
  const installer = Bun.YAML.parse(
    await Bun.file(
      new URL("../.github/workflows/installer-upgrade.yml", import.meta.url),
    ).text(),
  ) as { jobs: Record<string, WorkflowJob> };
  const upgrade = installer.jobs.upgrade!;
  expect(installer.jobs.baseline.if).toBe("inputs.baseline_sha == ''");
  expect(upgrade.if).toBe(
    "always() && (needs.baseline.result == 'success' || (needs.baseline.result == 'skipped' && inputs.baseline_sha != ''))",
  );
  expect(upgrade.needs).toBe("baseline");
  const freeze = workflow.jobs["validation-scope"].steps.find(
    (step) => step.name === "Freeze latest stable installer baseline",
  )!;
  expect(freeze.if).toBe("steps.scope.outputs.packaging == 'true'");
  expect(freeze.run).toBe("bun scripts/installer-upgrade.ts plan");
  expect(workflow.jobs["installer-upgrade"].with).toEqual({
    baseline_tag: "${{ needs.validation-scope.outputs.installer_tag }}",
    baseline_sha: "${{ needs.validation-scope.outputs.installer_sha }}",
    candidate_version:
      "${{ needs.validation-scope.outputs.installer_version }}",
    build_hash: "${{ needs.validation-scope.outputs.installer_hash }}",
  });
  expect(
    upgrade.strategy?.matrix?.include?.filter((row) =>
      row.runner?.startsWith("macos-"),
    ),
  ).toHaveLength(2);
  const lifecycle = upgrade.steps.find(
    (step) =>
      step.name === "Exercise the real plugin-managed launchd lifecycle",
  )!;
  expect(lifecycle.if).toBe("runner.os == 'macOS'");
  for (const action of ["start", "status", "restart", "uninstall"])
    expect(lifecycle.run).toContain(
      `PATH=/usr/bin:/bin "$plugin_launcher" ${action}`,
    );
  expect(lifecycle.run).toContain("http://127.0.0.1:8787/healthz");
  expect(lifecycle.run).toContain("trap cleanup EXIT");
  expect(
    upgrade.steps.find(
      (step) => step.run === "bun scripts/world-plugin.ts compile-launcher",
    )?.if,
  ).toBe("runner.os == 'macOS'");
  const native = upgrade.steps.find(
    (step) =>
      step.name ===
      "Verify Bun-free installation and prepare the native compatibility launcher",
  )!;
  expect(native.if).toBe("runner.os == 'macOS'");
  expect(native.run).toContain(
    "scripts/install-plugin.test.ts scripts/plugin-native.test.ts server/src/config/plugin-command.test.ts",
  );
  for (const step of workflow.jobs.delivery.steps.filter(
    (step) => step.run === "bun scripts/ci-delivery-result.ts",
  ))
    expect(step.env?.LAUNCHD_RESULT).toBe("${{ needs.launchd.result }}");
});

test("accepted behavioral evidence stays unfiltered whenever its protected dependency runs", async () => {
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
  const job = candidate.jobs.shards;
  expect(job.strategy?.matrix?.shard).toEqual([1, 2, 3]);
  expect(job.strategy?.["fail-fast"]).toBe(false);
  expect(candidate.jobs.candidate.needs).toBe("shards");
  expect(candidate.jobs.candidate.name).toBe("Behavioral verification");
  expect(
    candidate.jobs.candidate.steps.some(
      (step) => step.run === "bun scripts/ci-verification.ts aggregate",
    ),
  ).toBe(true);
  expect(job.if).toBeUndefined();
  expect(job["continue-on-error"]).toBeUndefined();
  expect(job["timeout-minutes"]).toBe(20);
  const verify = job.steps.find(
    (step) =>
      step.run ===
      "bun run verification:resources --system --shard=${{ matrix.shard }}/3",
  )!;
  expect(verify).toBeDefined();
  expect(verify.if).toBe("steps.reuse.outputs.reused != 'true'");
  expect(verify["continue-on-error"]).toBeUndefined();
  expect(
    job.steps.some((step) => step.run === "bun run verification:setup"),
  ).toBe(true);
  const artifact = job.steps.find(
    (step) => step.name === "Retain source-bound evidence manifests",
  )!;
  expect(artifact.if).toBe("always()");
  expect(
    (artifact.with as { "if-no-files-found"?: string })["if-no-files-found"],
  ).toBe("warn");
  expect(
    job.steps.some((step) => step.uses?.startsWith("actions/cache@")),
  ).toBe(true);
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
    "needs.validation-scope.outputs.verification == 'true'",
  );
  for (const step of workflow.jobs.delivery.steps.filter(
    (step) => step.run === "bun scripts/ci-delivery-result.ts",
  )) {
    expect(step.env?.BEHAVIORAL_RESULT).toBe("${{ needs.behavioral.result }}");
  }
});

test("Windows plugin assertions share the native installer runners", async () => {
  const installer = Bun.YAML.parse(
    await Bun.file(
      new URL("../.github/workflows/installer-upgrade.yml", import.meta.url),
    ).text(),
  ) as { jobs: Record<string, WorkflowJob> };
  expect(workflow.jobs["plugin-windows"]).toBeUndefined();
  const step = installer.jobs.upgrade.steps.find(
    (step) =>
      step.name ===
      "Verify Windows Bun-free plugin installation and frozen actions",
  )!;
  expect(step.if).toBe("runner.os == 'Windows'");
  expect(step.run).toContain(
    "scripts/install-plugin.windows.test.ts scripts/plugin-native.test.ts server/src/config/plugin-command.test.ts",
  );
});

test("red main runs open one alert and an unmerged revert; green runs resolve it", async () => {
  const gate = Bun.YAML.parse(
    await Bun.file(
      new URL("../.github/workflows/main-gate.yml", import.meta.url),
    ).text(),
  ) as {
    on: {
      workflow_run: {
        workflows: string[];
        types: string[];
        branches: string[];
      };
    };
    jobs: Record<string, WorkflowJob>;
    permissions?: Record<string, string>;
  };
  expect(gate.on.workflow_run).toEqual({
    workflows: ["CI"],
    types: ["completed"],
    branches: ["main"],
  });
  const alert = gate.jobs.alert!;
  // Only push runs on main count; PR runs whose head branch is named main do not.
  expect(alert.if).toBe(
    "github.event.workflow_run.event == 'push' && (github.event.workflow_run.conclusion == 'failure' || github.event.workflow_run.conclusion == 'success')",
  );
  const script = alert.steps.at(-1)!;
  expect(script.run).toContain("bun scripts/main-gate.ts");
  expect(script.run).not.toContain("gh pr merge");
  // The gate dispatches CI on the revert it prepares, which needs Actions write.
  const gateSource = await Bun.file(
    new URL("./main-gate.ts", import.meta.url),
  ).text();
  expect(gateSource).toContain('"workflow", "run", "CI"');
  expect(gate.permissions?.actions).toBe("write");
  // Nothing reruns a red run.
  expect(gateSource).not.toContain('"run", "rerun"');
});

test("release validation passes the full non-PR plan to the shared browser workflow", async () => {
  const release = Bun.YAML.parse(
    await Bun.file(
      new URL("../.github/workflows/release.yml", import.meta.url),
    ).text(),
  ) as {
    jobs: Record<
      string,
      {
        outputs?: { selection?: string };
        steps?: WorkflowStep[];
        with?: { selection?: string };
      }
    >;
  };
  expect(release.jobs.validate.outputs?.selection).toBe(
    "${{ steps.scope.outputs.selection }}",
  );
  expect(
    release.jobs.validate.steps?.some(
      (step) => step.run === "bun scripts/ci-reuse-full-check.ts",
    ),
  ).toBe(true);
  expect(release.jobs["world-browser"].with?.selection).toBe(
    "${{ needs.validate.outputs.selection }}",
  );
});
