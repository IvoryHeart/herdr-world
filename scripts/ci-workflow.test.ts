import { expect, test } from "bun:test";
import {
  DESCRIPTION_STEP,
  HOLD_STEP,
  SCOPE_JOB,
  SCOPE_STEP,
  STABILITY_LABEL,
} from "./ci-reuse-full-check";
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
  concurrency: { group: string; "cancel-in-progress": boolean };
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
  const requested = `\${{ contains(github.event.pull_request.labels.*.name, '${STABILITY_LABEL}') }}`;
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

const OPEN_PR =
  "github.event_name != 'pull_request' || github.event.pull_request.state == 'open'";
const SCOPE_RAN = "needs.validation-scope.result != 'skipped'";

test("a closed or merged PR's edit or label skips every job before it takes a runner", () => {
  const scope = workflow.jobs["validation-scope"];
  expect(scope.if).toContain(OPEN_PR.split(" || ")[0]);
  expect(scope.if).toContain("github.event.pull_request.state == 'open'");
  expect(scope.if).toContain("github.event.action != 'labeled'");
  expect(scope.needs).toBeUndefined();
  const needs = (name: string): string[] => {
    const direct = workflow.jobs[name]!.needs ?? [];
    return typeof direct === "string" ? [direct] : direct;
  };
  const reachesScope = (name: string): boolean =>
    needs(name).some(
      (need) => need === "validation-scope" || reachesScope(need),
    );
  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (name === "validation-scope") continue;
    if (name === "browser-diagnostics") {
      // Manual dispatch only; never a PR event.
      expect(job.if).toStartWith("github.event_name == 'workflow_dispatch'");
      continue;
    }
    // A skipped scope skips every dependent job, except one that runs always().
    expect(reachesScope(name)).toBe(true);
    if (job.if?.includes("always()")) {
      expect(needs(name)).toContain("validation-scope");
      expect(job.if).toContain(SCOPE_RAN);
    }
  }
});

test("a description-only edit reuses the dependency audit with the rest of the evidence", () => {
  const audit = workflow.jobs["dependency-security"];
  expect(audit.needs).toBe("validation-scope");
  expect(audit.if).toBe(
    "needs.validation-scope.outputs.mode != 'reuse' && needs.validation-scope.outputs.mode != 'hold'",
  );
  const step = workflow.jobs.delivery.steps.find(
    (step) => step.name === "Require current dependency security audit",
  )!;
  expect(step.env).toEqual({
    SECURITY_RESULT: "${{ needs.dependency-security.result }}",
    VALIDATION_MODE: "${{ needs.validation-scope.outputs.mode }}",
  });
  const passes = (mode: string, result: string) =>
    Bun.spawnSync(["bash", "-euc", step.run!], {
      env: {
        PATH: process.env.PATH,
        VALIDATION_MODE: mode,
        SECURITY_RESULT: result,
      },
    }).exitCode === 0;
  expect(passes("full", "success")).toBe(true);
  expect(passes("scoped", "success")).toBe(true);
  expect(passes("reuse", "skipped")).toBe(true);
  // A held red result reaches the step that names it.
  expect(passes("hold", "skipped")).toBe(true);
  expect(passes("full", "skipped")).toBe(false);
  expect(passes("docs", "skipped")).toBe(false);
  expect(passes("full", "failure")).toBe(false);
  expect(passes("reuse", "failure")).toBe(false);
  expect(passes("", "skipped")).toBe(false);
});

test("release-note labels skip closed PRs and description-only edits", async () => {
  const label = Bun.YAML.parse(
    await Bun.file(
      new URL("../.github/workflows/label-pull-requests.yml", import.meta.url),
    ).text(),
  ) as {
    on: { pull_request_target: { types: string[] } };
    jobs: Record<string, WorkflowJob>;
  };
  expect(label.on.pull_request_target.types).toContain("edited");
  expect(label.jobs.label.if).toBe(
    "github.event.pull_request.state == 'open' && (github.event.action != 'edited' || github.event.changes.title || github.event.changes.base)",
  );
  // The classifier reads no description, so skipping body edits loses nothing.
  const classify = label.jobs.label.steps.find(
    (step) => step.name === "Classify pull request",
  )!;
  expect(Object.keys(classify.env ?? {})).not.toContain("PR_BODY");
  expect(classify.run).not.toContain("body");
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
    "labeled",
  ]);
  expect(workflow.permissions.actions).toBe("read");
  // Every main commit retains its own run so an owner tag can await it.
  expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
  expect(workflow.on.push).toEqual({ branches: ["main"] });
  expect(workflow.concurrency.group).toContain(
    "(github.event_name == 'push' && github.sha)",
  );
  const delivery = workflow.jobs.delivery;

  expect(delivery?.name).toBe("Delivery checks");
  expect(delivery?.needs).toEqual([
    "validation-scope",
    "validation",
    "world-browser",
    "behavioral",
    "dependency-security",
  ]);
  expect(delivery?.if).toBe(
    "always() && needs.validation-scope.result != 'skipped'",
  );
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

test("no timing gates delivery: browser jobs use the pinned Chrome and retry failures once", () => {
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
  // PR and main pushes measure browser inputs; nightly runs remain unfiltered.
  const push = trend.on.push as { branches: string[]; paths: string[] };
  expect(push.branches).toEqual(["main"]);
  for (const path of [
    "web/src/**",
    "shared/**",
    "bun.lock",
    "scripts/run-world-tests.ts",
    "scripts/world-browser-suites.ts",
    "scripts/latency-trend.ts",
    ".github/workflows/world-latency-trend.yml",
  ])
    expect(push.paths).toContain(path);
  expect(push.paths.some((path) => path.startsWith("server/"))).toBe(false);
  expect(trend.on.pull_request).toMatchObject({
    types: ["labeled", "synchronize"],
  });
  expect(trend.on.schedule).toEqual([{ cron: "53 3 * * *" }]);
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
  expect(workflow.jobs["world-latency-trend"]).toBeUndefined();
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
  expect(world.steps.filter((step) => step["continue-on-error"])).toHaveLength(
    1,
  );
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
  expect(web.steps.filter((step) => step["continue-on-error"])).toHaveLength(1);
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

test("reuse recognises a description-only failure by the scope job's real names", () => {
  const scope = workflow.jobs["validation-scope"];
  expect(scope.name).toBe(SCOPE_JOB);
  const names = scope.steps.map((step) => step.name);
  // The description is checked before, and stops, the scope decision.
  expect(names.indexOf(DESCRIPTION_STEP)).toBeGreaterThanOrEqual(0);
  expect(names.indexOf(SCOPE_STEP)).toBeGreaterThan(
    names.indexOf(DESCRIPTION_STEP),
  );
  const description = scope.steps.find(
    (step) => step.name === DESCRIPTION_STEP,
  )!;
  expect(description["continue-on-error"]).toBeUndefined();
  expect(
    scope.steps.find((step) => step.name === SCOPE_STEP)!.if,
  ).toBeUndefined();
});

test("a metadata event on a red head fails the scope job by name and starts no code job", () => {
  const scope = workflow.jobs["validation-scope"];
  const names = scope.steps.map((step) => step.name);
  // It follows the scope decision and precedes any installer work.
  expect(names.indexOf(HOLD_STEP)).toBeGreaterThan(names.indexOf(SCOPE_STEP));
  const hold = scope.steps.find((step) => step.name === HOLD_STEP)!;
  expect(hold.if).toBe("steps.scope.outputs.mode == 'hold'");
  expect(hold["continue-on-error"]).toBeUndefined();
  const run = Bun.spawnSync(["bash", "-euc", hold.run!], {
    env: { PATH: process.env.PATH, HELD_RUN: "7", EVENT: "pull_request" },
  });
  expect(run.exitCode).toBe(1);
  expect(run.stdout.toString()).toContain("Run 7");
  // A failed scope job skips every job that does not run always(); of those,
  // only the protected reports run, and they fail.
  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (!job.if?.includes("always()")) continue;
    expect(["validation", "delivery", "release-candidate"]).toContain(name);
  }
  expect(workflow.jobs.validation.if).toContain(
    "needs.validation-scope.outputs.mode != 'hold'",
  );
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
  expect(verify["continue-on-error"]).toBe(true);
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
  ).toBe(true);
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

test("behavioral checks retain each main version commit's evidence", async () => {
  const behavioral = Bun.YAML.parse(
    await Bun.file(
      new URL(
        "../.github/workflows/behavioral-verification.yml",
        import.meta.url,
      ),
    ).text(),
  ) as { concurrency: { group: string } };
  expect(behavioral.concurrency.group).toContain(
    "(github.event_name == 'push' && github.sha)",
  );
});

test("an in-job model retry preserves failed evidence outside the aggregate's live inputs", async () => {
  const {
    mkdtempSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    rmSync,
    readdirSync,
  } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const root = mkdtempSync(join(tmpdir(), "model-retry-"));
  try {
    const candidate = Bun.YAML.parse(
      await Bun.file(".github/workflows/behavioral-verification.yml").text(),
    ) as any;
    const retry = candidate.jobs.shards.steps.find(
      (step: any) =>
        step.name === "Retry failed test once" &&
        step.run.includes("verification:resources"),
    );
    const prefix = join(root, ".agents/verification");
    mkdirSync(join(prefix, "runs/ci-shard-1-failed"), { recursive: true });
    mkdirSync(join(prefix, "resources/first"), { recursive: true });
    writeFileSync(
      join(prefix, "runs/ci-shard-1-failed/manifest.json"),
      "failed shard",
    );
    writeFileSync(
      join(prefix, "resources/first/resources.json"),
      "failed accounting",
    );
    mkdirSync(join(root, "bin"));
    writeFileSync(
      join(root, "bin/bun"),
      "#!/bin/sh\nmkdir -p .agents/verification/runs/ci-shard-1-retry .agents/verification/resources/retry\nprintf success > .agents/verification/runs/ci-shard-1-retry/manifest.json\nprintf success > .agents/verification/resources/retry/resources.json\n",
      { mode: 0o755 },
    );
    const run = Bun.spawnSync(
      ["bash", "-euc", retry.run.replaceAll("${{ matrix.shard }}", "1")],
      {
        cwd: root,
        env: { PATH: `${root}/bin:${process.env.PATH}` },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(run.stderr.toString()).toBe("");
    expect(run.exitCode).toBe(0);
    expect(readdirSync(join(prefix, "runs"))).toEqual(["ci-shard-1-retry"]);
    expect(readdirSync(join(prefix, "resources"))).toEqual(["retry"]);
    expect(
      readFileSync(
        join(prefix, "retries/first-runs/ci-shard-1-failed/manifest.json"),
        "utf8",
      ),
    ).toBe("failed shard");
    expect(
      readFileSync(
        join(prefix, "retries/first-resources/first/resources.json"),
        "utf8",
      ),
    ).toBe("failed accounting");
    const upload = candidate.jobs.shards.steps.find(
      (step: any) => step.name === "Retain source-bound evidence manifests",
    );
    expect(upload.with.path).toContain(".agents/verification/retries/**");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("nightly native plugin regressions run each OS's own installer test", async () => {
  const candidate = Bun.YAML.parse(
    await Bun.file(
      new URL("../.github/workflows/release-candidate.yml", import.meta.url),
    ).text(),
  ) as { jobs: Record<string, WorkflowJob> };
  const steps = candidate.jobs.package.steps;
  const windows = steps.find(
    (step) => step.name === "Nightly native Windows plugin regressions",
  )!;
  const unix = steps.find(
    (step) => step.name === "Nightly native Unix plugin regressions",
  )!;
  expect(windows.if).toBe("inputs.nightly && runner.os == 'Windows'");
  expect(windows.run).toContain("scripts/install-plugin.windows.test.ts");
  expect(windows.run).not.toContain("scripts/install-plugin.test.ts");
  expect(unix.if).toBe("inputs.nightly && runner.os != 'Windows'");
  expect(unix.run).toContain("scripts/install-plugin.test.ts");
  for (const step of steps) {
    if (step.run?.includes("scripts/install-plugin.test.ts")) {
      expect(step.if).toContain("runner.os != 'Windows'");
    }
  }
});

test("release candidate packages and verifies natively on Windows", async () => {
  const candidate = Bun.YAML.parse(
    await Bun.file(
      new URL("../.github/workflows/release-candidate.yml", import.meta.url),
    ).text(),
  ) as { jobs: Record<string, WorkflowJob> };
  const build = candidate.jobs.package.steps.find(
    (step) => step.name === "Build release package once",
  )!;
  // Bun's shell cannot execute a .sh script on Windows.
  expect(build.run).toContain("bash scripts/package-release.sh");
  expect(build.run).not.toContain("bun run package:");
  const verify = await Bun.file(
    new URL("./verify-release-package.sh", import.meta.url),
  ).text();
  // GNU tar reads "D:" in a Windows temp path as a remote host.
  expect(verify).toMatch(
    /MINGW\* \| MSYS\* \| CYGWIN\*\) tar --force-local -xJf/,
  );
});
