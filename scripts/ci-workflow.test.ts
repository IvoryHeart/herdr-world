import { verificationGroups } from "./ci-model-plan";
import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  with?: {
    "fetch-depth"?: number;
    filter?: string;
    ref?: string;
    "persist-credentials"?: boolean;
  };
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
      include?: Array<Record<string, string | number>>;
      platform?: string[];
      shard?: number[] | string;
      arch?: string[];
      suite?: string[];
      suites?: string[];
      order?: string[];
      group?: string | string[];
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

// Evaluate the default full run (no optional preview/diagnostic labels), then
// recursively count runner leaves. Reusable callers themselves take no runner.
function fullModeJobs(event: string) {
  const selection = JSON.stringify({
    world: ["all"],
    web: ["all"],
    worldShards: worldBrowserShards.map((_, i) => i + 1),
  });
  const github = {
    event_name: event,
    workflow: "CI",
    ref: "refs/heads/branch",
    event: {
      action: "opened",
      pull_request: { state: "open", labels: [] },
      label: { name: "" },
    },
  };
  const needs = {
    "validation-scope": {
      result: "success",
      outputs: {
        mode: "full",
        world: "true",
        verification: "true",
        selection,
      },
    },
  };
  const evaluate = (value: string, inputs: Record<string, unknown>) => {
    const expression = value
      .replace(/^\$\{\{\s*|\s*\}\}$/g, "")
      .replace(/needs\.([\w-]+)/g, 'needs["$1"]')
      .replace(
        "github.event.pull_request.labels.*.name",
        "github.event.pull_request.labels",
      );
    return new Function(
      "github",
      "needs",
      "inputs",
      "fromJSON",
      "toJSON",
      "contains",
      "always",
      "cancelled",
      `return (${expression})`,
    )(
      github,
      needs,
      inputs,
      JSON.parse,
      JSON.stringify,
      (items: string | string[], item: string) => items.includes(item),
      () => true,
      () => false,
    );
  };
  const count = (
    jobs: Record<string, WorkflowJob>,
    inputs: Record<string, unknown>,
  ): number =>
    Object.values(jobs).reduce((sum, job) => {
      if (job.if && !evaluate(job.if, inputs)) return sum;
      const matrix = job.strategy?.matrix;
      let expansions = 1;
      if (matrix) {
        const { include, ...axes } = matrix;
        const values = Object.values(axes).map((axis) =>
          typeof axis === "string" ? evaluate(axis, inputs) : axis,
        );
        expansions = values.reduce((n, axis) => n * axis.length, 1);
        // Current include-only matrices add one runner per row.
        if (include) {
          expect(values).toHaveLength(0);
          expansions = include.length;
        }
      }
      if (job.uses) {
        expect(job.uses).toStartWith("./.github/workflows/");
        const called = Bun.YAML.parse(
          readFileSync(job.uses.slice(2), "utf8"),
        ) as { jobs: Record<string, WorkflowJob> };
        const calledInputs = Object.fromEntries(
          Object.entries(job.with ?? {}).map(([key, value]) => [
            key,
            value.startsWith("${{") ? evaluate(value, inputs) : value,
          ]),
        );
        return sum + expansions * count(called.jobs, calledInputs);
      }
      expect(job["runs-on"]).toBeDefined();
      return sum + expansions;
    }, 0);
  return count(workflow.jobs, { browser_diagnostics: false });
}

test("the full-mode graph uses at most sixteen jobs, including every reusable matrix expansion", () => {
  for (const event of ["pull_request", "merge_group", "workflow_dispatch"])
    expect(fullModeJobs(event)).toBeLessThanOrEqual(16);
});

test("combined runner workloads survive unit failure but stop on cancellation", () => {
  const steps = workflow.jobs["unit-tests"].steps;
  const workloads = steps.filter(
    (step) =>
      step.run === "bun run check:static --static-group=${{ matrix.group }}" ||
      step.run === "bun run security:check" ||
      step.run?.startsWith("bun scripts/test-chrome.ts") ||
      step.run?.startsWith("bun scripts/ci-tests.ts web ") ||
      step.uses?.startsWith("actions/cache@"),
  );
  expect(workloads).toHaveLength(5);
  for (const step of workloads) {
    const evaluate = new Function(
      "cancelled",
      "always",
      "matrix",
      "needs",
      "fromJSON",
      "toJSON",
      `return (${step.if!.replace(/^\$\{\{\s*|\s*\}\}$/g, "").replace(/needs\.([\w-]+)/g, 'needs["$1"]')})`,
    );
    for (const cancelled of [false, true]) {
      expect(
        evaluate(
          () => cancelled,
          () => true,
          { group: "repository", web: 1 },
          {
            "validation-scope": {
              outputs: { world: "true", selection: '{"web":["all"]}' },
            },
          },
          JSON.parse,
          JSON.stringify,
        ),
      ).toBe(!cancelled);
    }
    expect(step.if).toContain("cancelled()");
  }
});

test("Delivery evidence conditions reference only declared dependencies", () => {
  const delivery = workflow.jobs.delivery;
  for (const step of delivery.steps) {
    for (const match of step.if?.matchAll(/needs\.([\w-]+)\./g) ?? [])
      expect(delivery.needs).toContain(match[1]!);
  }
});

test("flaky reporting uses only a daily schedule or manual default-branch run", async () => {
  const tracker = Bun.YAML.parse(
    await Bun.file(".github/workflows/flaky-tests.yml").text(),
  ) as {
    on: Record<string, unknown>;
    name: string;
    jobs: Record<string, WorkflowJob>;
    permissions: Record<string, string>;
    concurrency: unknown;
  };
  expect(Object.keys(tracker.on).sort()).toEqual([
    "schedule",
    "workflow_dispatch",
  ]);
  expect(tracker.on.schedule).toEqual([{ cron: "17 4 * * *" }]);
  expect(tracker.name).toBe("Daily flaky tests");
  expect(Object.keys(tracker.jobs)).toEqual(["report"]);
  expect(tracker.permissions).toEqual({
    contents: "read",
    actions: "read",
    issues: "write",
  });
  expect(tracker.concurrency).toEqual({
    group: "daily-flaky-tests",
    "cancel-in-progress": false,
  });
  const job = tracker.jobs.report;
  expect(job.if).toContain("github.event.repository.default_branch");
  expect(job.steps[0]!.with?.ref).toBe(
    "${{ github.event.repository.default_branch }}",
  );
  expect(job.steps[0]!.with?.["persist-credentials"]).toBe(false);
  expect(
    job.steps
      .filter((step: WorkflowStep) => step.run?.includes("flaky-tests.ts"))
      .map((step: WorkflowStep) => step.run),
  ).toEqual(["bun scripts/flaky-tests.ts daily"]);
  expect(
    workflow.jobs.delivery.steps.some((step) =>
      /flaky-tests\.ts (gate|track|pending)/.test(step.run || ""),
    ),
  ).toBe(false);
  const download = workflow.jobs.delivery.steps.find(
    (step) => step.name === "Download flaky test evidence",
  );
  expect(download?.with).toMatchObject({
    pattern: "flaky-tests-*-${{ github.run_attempt }}",
  });
  expect(download?.with).not.toHaveProperty("merge-multiple");
  for (const step of workflow.jobs.delivery.steps.filter((step) =>
    /flaky|retry/i.test(step.name || ""),
  )) {
    expect(step["continue-on-error"]).toBe(true);
  }
});

test("retry summaries and flaky.json artifacts stay inside existing test jobs and cannot fail them", () => {
  for (const job of [
    workflow.jobs["unit-tests"],
    worldWorkflow.jobs["world-browser"],
  ]) {
    const summarize = job.steps.find((step) =>
      step.run?.startsWith("bun scripts/flaky-tests.ts summarize"),
    );
    expect(summarize?.if).toBe("always()");
    expect(summarize?.["continue-on-error"]).toBe(true);
    expect(summarize?.env?.GH_TOKEN).toBeUndefined();
    const upload = job.steps.find(
      (step) => step.name === "Retain flaky test evidence",
    );
    expect(upload?.if).toBe("always()");
    expect(upload?.["continue-on-error"]).toBe(true);
    expect((upload?.with as Record<string, unknown>)?.path).toBe(
      ".agents/delivery/flaky/flaky.json",
    );
  }
});

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

test("delivery checks the combined lanes, current audit and PR description", () => {
  expect(workflow.jobs["dependency-security"]).toBeUndefined();
  expect(
    workflow.jobs["unit-tests"].steps.find(
      (step) => step.run === "bun run security:check",
    ),
  ).toMatchObject({
    if: "${{ !cancelled() && matrix.group == 'repository' }}",
  });
  expect(
    workflow.jobs.static.steps.some(
      (step) => step.run === "bun run security:check",
    ),
  ).toBe(true);
  const resultSteps = workflow.jobs.delivery.steps.filter(
    (step) => step.run === "bun scripts/ci-delivery-result.ts",
  );
  expect(resultSteps).toHaveLength(2);
  for (const step of resultSteps)
    expect(step.env).toMatchObject({
      SCOPE_RESULT: "${{ needs.validation-scope.result }}",
      DESCRIPTION_RESULT: "${{ steps.description.outcome || 'skipped' }}",
      SECURITY_RESULT:
        "${{ needs.validation-scope.outputs.mode == 'docs' && needs.static.result || needs.unit-tests.result }}",
      STATIC_RESULT:
        "${{ needs.validation-scope.outputs.mode == 'docs' && needs.static.result || needs.unit-tests.result }}",
      UNIT_RESULT: "${{ needs.unit-tests.result }}",
      WORLD_RESULT: "${{ needs.world-browser.result }}",
      WEB_RESULT:
        "${{ needs.validation-scope.outputs.world == 'true' && toJSON(fromJSON(needs.validation-scope.outputs.selection).web) != '[]' && needs.unit-tests.result || 'skipped' }}",
      BEHAVIORAL_RESULT: "${{ needs.behavioral.result }}",
    });
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
    "static",
    "unit-tests",
    "world-browser",
    "behavioral",
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
      STATIC_RESULT:
        "${{ needs.validation-scope.outputs.mode == 'docs' && needs.static.result || needs.unit-tests.result }}",
      WORLD_RESULT: "${{ needs.world-browser.result }}",
    },
  });
  expect(workflow.jobs.validation).toBeUndefined();
  expect(worldWorkflow.jobs["web-browser"]).toBeUndefined();
  expect(workflow.jobs["world-browser"].needs).toBe("validation-scope");
  expect(
    workflow.jobs["unit-tests"].strategy?.matrix?.include?.map(
      (row) => row.shard,
    ),
  ).toEqual([1, 2, 3, 4]);
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
  expect(scope.steps.some((step) => step.name === DESCRIPTION_STEP)).toBe(
    false,
  );
  const checkout = scope.steps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  expect(checkout?.with).toMatchObject({
    "fetch-depth": 0,
    filter: "blob:none",
  });
  expect(workflow.jobs.validate).toBeUndefined();
});

test("unit shards run four files at a time, build only for their consumers and require comparison evidence", () => {
  const job = workflow.jobs["unit-tests"];
  expect(job.name).toBe("Non-browser tests (${{ matrix.shard }}/4)");
  expect(job["timeout-minutes"]).toBe(
    "${{ needs.validation-scope.outputs.unit_comparison == 'true' && 120 || 20 }}",
  );
  expect(
    (job as WorkflowJob & { env: Record<string, string> }).env,
  ).toMatchObject({
    HERDR_TEST_PARALLEL: "4",
    HERDR_TEST_MAX_CONCURRENCY: "2",
    HERDR_TEST_EXCLUDE_WORLD_BROWSER: "1",
  });
  expect(job.steps.find((step) => step.id === "unit-plan")?.run).toBe(
    "bun scripts/ci-tests.ts unit ${{ matrix.shard }}/4 --plan",
  );
  expect(job.steps.find((step) => step.run === "bun run build")?.if).toBe(
    "steps.unit-plan.outputs.build == 'true'",
  );
  expect(job.steps.filter((step) => step.run === "bun run build")).toHaveLength(
    1,
  );
  expect(
    job.steps.find(
      (step) =>
        step.run === "bun scripts/ci-tests.ts unit ${{ matrix.shard }}/4",
    )?.if,
  ).toBe("needs.validation-scope.outputs.unit_comparison != 'true'");
  expect(
    job.steps.find(
      (step) =>
        step.run ===
        "bun scripts/ci-unit-comparison.ts run ${{ matrix.shard }}/4",
    ),
  ).toMatchObject({
    if: "needs.validation-scope.outputs.unit_comparison == 'true'",
  });
  expect(
    job.steps.find(
      (step) =>
        step.name === "Retain unit JUnit, comparison inventory and timings",
    )?.if,
  ).toBe("always()");
  expect(
    job.steps.find((step) => step.name === "Retain flaky test evidence")?.if,
  ).toBe("always()");
  expect(
    job.steps
      .filter((step) => step["continue-on-error"])
      .map((step) => step.name),
  ).toEqual(["Summarize retry evidence", "Retain flaky test evidence"]);
  expect(
    workflow.jobs["validation-scope"].steps.find(
      (step) => step.id === "unit-comparison",
    ),
  ).toMatchObject({
    run: "bun scripts/ci-unit-comparison.ts required",
    env: {
      UNIT_COMPARISON_BASE:
        "${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha }}",
    },
  });
});

test("Delivery reports timings after every verdict without making timing a gate", () => {
  const steps = workflow.jobs.delivery.steps;
  expect(steps.at(-1)).toEqual({
    name: "Report run timings",
    if: "always()",
    env: { GH_TOKEN: "${{ github.token }}" },
    run: "bun scripts/ci-run-timing.ts",
  });
  expect(workflow.permissions.actions).toBe("read");
  expect(
    steps.findIndex(
      (step) => step.name === "Verify applicable or reused results",
    ),
  ).toBeLessThan(steps.length - 1);
});

test("no timing gates delivery: browser jobs use the pinned Chrome and delegate scoped recovery", () => {
  expect(worldWorkflow.jobs["latency-shards"]).toBeUndefined();
  expect(worldWorkflow.jobs["world-latency"]).toBeUndefined();
  expect(JSON.stringify(worldWorkflow)).not.toContain("--retry");
  expect(JSON.stringify(worldWorkflow)).not.toContain("latency");
  for (const job of [
    worldWorkflow.jobs["world-browser"]!,
    workflow.jobs["unit-tests"]!,
  ]) {
    const runs = job.steps.flatMap((step) => (step.run ? [step.run] : []));
    const chrome = runs.indexOf(
      'bun scripts/test-chrome.ts "$HOME/.cache/herdr-test-chrome"',
    );
    expect(chrome).toBeGreaterThan(-1);
    expect(chrome).toBeLessThan(
      runs.findIndex((run) =>
        /^bun scripts\/(?:ci-tests.ts web|ci-world-tests.ts) /.test(run),
      ),
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

test("World shards and packed web suites retain their partitions and failure evidence", () => {
  expect(workflow.jobs["world-browser"]).toMatchObject({
    needs: "validation-scope",
    if: "!cancelled() && needs.validation-scope.result == 'success' && needs.validation-scope.outputs.world == 'true' && toJSON(fromJSON(needs.validation-scope.outputs.selection).world) != '[]'",
    uses: "./.github/workflows/world-browser.yml",
  });
  expect(Object.keys(worldWorkflow.on)).toEqual(["workflow_call"]);
  expect(worldWorkflow.permissions.contents).toBe("read");
  const world = worldWorkflow.jobs["world-browser"];
  expect(world?.needs).toBeUndefined();
  expect(world?.if).toBe("toJSON(fromJSON(inputs.selection).world) != '[]'");
  expect(world?.["continue-on-error"] ?? false).toBe(false);
  expect(
    world.steps
      .filter((step) => step["continue-on-error"])
      .map((step) => step.name),
  ).toEqual(["Summarize retry evidence", "Retain flaky test evidence"]);
  expect(world?.["runs-on"]).toBe("ubuntu-latest");
  expect(world?.strategy?.matrix?.shard).toBe(
    "${{ fromJSON(inputs.selection).worldShards }}",
  );
  expect(world?.strategy?.["fail-fast"]).toBe(false);
  expect(worldBrowserShards).toHaveLength(6);
  expect(world?.strategy?.["max-parallel"]).toBe(6);
  expect(world?.name).toBe("World browser tests (${{ matrix.shard }}/6)");
  expect(
    world?.steps.find(
      (step) =>
        step.run === "bun scripts/ci-world-tests.ts ${{ matrix.shard }}",
    ),
  ).toMatchObject({
    env: {
      WORLD_TRACE_PREFIX: ".agents/delivery/world-production",
      WORLD_TIMINGS_ONLY: "1",
    },
  });
  expect(
    world?.steps.find(
      (step) => step.name === "Upload World test results and timings",
    ),
  ).toMatchObject({
    if: "always()",
    with: {
      path: expect.stringContaining(
        ".agents/delivery/world-production-*-inputs.json",
      ),
    },
  });
  expect(Object.keys(worldWorkflow.jobs)).toEqual(["world-browser"]);
  const packed = workflow.jobs["unit-tests"];
  const webStep = packed.steps.find(
    (step) => step.run === "bun scripts/ci-tests.ts web ${{ matrix.web }}/2",
  )!;
  expect(
    packed.strategy?.matrix?.include?.map((row) => row.web).filter(Boolean),
  ).toEqual([1, 2]);
  expect(webStep.env?.HERDR_TEST_EXCLUDE_WORLD_BROWSER).toBe("0");
  expect(webStep.if).toContain("!cancelled()");
  expect(webStep.if).toContain("matrix.web != 0");
  expect(webStep.if).toContain(".web) != '[]'");
  expect(packed.steps.indexOf(webStep)).toBeGreaterThan(
    packed.steps.findIndex(
      (step) => step.name === "Run affected non-browser tests",
    ),
  );
  expect(
    packed.steps.filter(
      (step) =>
        step["continue-on-error"] && !/retry|flaky/i.test(step.name || ""),
    ),
  ).toHaveLength(0);
  expect(
    packed.steps.find(
      (step) => step.run === "bun scripts/ci-tests.ts web ${{ matrix.web }}/2",
    ),
  ).toMatchObject({
    run: "bun scripts/ci-tests.ts web ${{ matrix.web }}/2",
    env: { HERDR_TEST_PARALLEL: "2", HERDR_TEST_MAX_CONCURRENCY: "2" },
  });
  expect(
    packed.steps.find((step) =>
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

test("description policy runs independently without preventing the scope decision", () => {
  const scope = workflow.jobs["validation-scope"];
  expect(scope.name).toBe(SCOPE_JOB);
  expect(scope.steps.some((step) => step.name === DESCRIPTION_STEP)).toBe(
    false,
  );
  expect(
    scope.steps.find((step) => step.name === SCOPE_STEP)!.if,
  ).toBeUndefined();
  const description = workflow.jobs.delivery.steps.find(
    (step) => step.name === DESCRIPTION_STEP,
  )!;
  expect(description["continue-on-error"]).toBeUndefined();
  const checkout = workflow.jobs.delivery.steps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  expect(checkout?.with?.["fetch-depth"]).toBe(0);
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
    expect(["pr-description", "delivery", "release-candidate"]).toContain(name);
  }
  expect(workflow.jobs.validation).toBeUndefined();
});

test("maintained tooling checks run once on the first group even with complete cache hits", async () => {
  const candidate = Bun.YAML.parse(
    await Bun.file(".github/workflows/behavioral-verification.yml").text(),
  ) as { jobs: Record<string, WorkflowJob> };
  expect(candidate.jobs.tooling).toBeUndefined();
  const steps = candidate.jobs.shards.steps;
  for (const name of [
    "Install locked development tooling",
    "Validate maintained types and tooling notices",
  ]) {
    const checks = steps.filter((step) => step.name === name);
    expect(checks).toHaveLength(1);
    expect(checks[0].if).toBe("matrix.shard == 1");
    expect(checks[0]["continue-on-error"]).toBeUndefined();
  }
  expect(
    steps.find((step) => step.run === "bun install --frozen-lockfile")?.if,
  ).toBe("matrix.shard == 1 || steps.reuse.outputs.reused != 'true'");
  expect(
    steps.find(
      (step) => step.name === "Validate maintained types and tooling notices",
    )?.run,
  ).toBe(
    "bun run verification:typecheck\nbun run verification:notices:check\n",
  );
  expect(candidate.jobs.candidate.needs).toBe("shards");
  expect(workflow.jobs.delivery.needs).toContain("behavioral");
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
  expect(workflow.jobs["model-evidence"].if).toBe(
    "github.event_name == 'push' && github.ref == 'refs/heads/main'",
  );
  expect(workflow.jobs["model-evidence"].uses).toBe(
    "./.github/workflows/behavioral-verification.yml",
  );
  expect(workflow.jobs.delivery.needs).not.toContain("model-evidence");
  expect(candidate.on.workflow_call).toBeNull();
  expect(candidate.permissions).toEqual({ contents: "read" });
  const job = candidate.jobs.shards;
  expect(job.strategy?.matrix?.shard).toEqual(
    verificationGroups.map((_, index) => index + 1),
  );
  expect(job.strategy?.["fail-fast"]).toBe(false);
  expect(candidate.jobs.candidate.needs).toBe("shards");
  expect(candidate.jobs.candidate.name).toBe("Behavioral verification");
  expect(candidate.jobs.candidate.if).toBe(
    "github.event_name == 'workflow_dispatch' && github.workflow == 'Behavioral verification'",
  );
  const aggregate = workflow.jobs.delivery.steps.find(
    (step) => step.run === "bun scripts/ci-verification.ts aggregate",
  );
  expect(aggregate?.if).toBe(
    "needs.validation-scope.outputs.verification == 'true' && needs.behavioral.result == 'success'",
  );
  const download = workflow.jobs.delivery.steps.find(
    (step) =>
      step.uses?.startsWith("actions/download-artifact@") &&
      (step.with as { pattern?: string })?.pattern === "behavioral-shard-*",
  );
  expect(download).toMatchObject({
    if: aggregate!.if,
    with: {
      pattern: "behavioral-shard-*",
      path: ".agents/verification",
      "merge-multiple": true,
    },
  });
  const upload = workflow.jobs.delivery.steps.find(
    (step) =>
      step.uses?.startsWith("actions/upload-artifact@") &&
      (step.with as { name?: string })?.name?.startsWith(
        "behavioral-evidence-",
      ),
  );
  expect(upload).toMatchObject({
    if: "always() && needs.validation-scope.outputs.verification == 'true'",
    with: {
      name: "behavioral-evidence-${{ github.run_attempt }}",
      "if-no-files-found": "error",
    },
  });
  for (const job of [workflow.jobs.delivery, candidate.jobs.candidate]) {
    expect(
      job.steps.some((step) =>
        /actions\/setup-(?:node|java)@/.test(step.uses || ""),
      ),
    ).toBe(false);
    expect(
      job.steps.some((step) => step.run?.includes("verification:setup")),
    ).toBe(false);
  }
  expect(
    candidate.jobs.candidate.steps.some(
      (step) => step.run === "bun scripts/ci-verification.ts aggregate",
    ),
  ).toBe(true);
  const keyStep = job.steps.findIndex((step) => step.id === "content");
  const restoreStep = job.steps.findIndex((step) => step.id === "reuse");
  const setupStep = job.steps.findIndex(
    (step) => step.run === "bun run verification:setup",
  );
  expect(keyStep).toBeLessThan(restoreStep);
  expect(restoreStep).toBeLessThan(setupStep);
  expect(job.steps[setupStep].if).toBe("steps.reuse.outputs.reused != 'true'");
  const save = job.steps.find((step) =>
    step.uses?.startsWith("actions/cache/save@"),
  )!;
  expect(save.if).toBe(
    "success() && github.event_name == 'push' && github.ref == 'refs/heads/main'",
  );
  const restore = job.steps.find((step) =>
    step.uses?.startsWith("actions/cache/restore@"),
  )!;
  expect(restore.if).toBe("github.event_name == 'pull_request'");
  const localLimits = JSON.parse(
    await Bun.file("tools/quint/resources.json").text(),
  );
  const modelLimits = JSON.parse(
    await Bun.file("tools/quint/model-resources.json").text(),
  );
  expect(localLimits.cpuQuotaPercent).toBe(200);
  expect(modelLimits).toEqual({ ...localLimits, cpuQuotaPercent: 400 });
  const localTlc = JSON.parse(await Bun.file("tools/quint/tlc.json").text());
  expect(JSON.parse(await Bun.file("tools/quint/tlc-ci.json").text())).toEqual({
    ...localTlc,
    workers: 4,
  });
  expect(job.if).toBeUndefined();
  expect(job["continue-on-error"]).toBeUndefined();
  expect(job["timeout-minutes"]).toBe(20);
  const verify = job.steps.find(
    (step) =>
      step.run === "bun scripts/ci-model-groups.ts run ${{ matrix.shard }}",
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
    "!cancelled() && needs.validation-scope.result == 'success' && needs.validation-scope.outputs.verification == 'true'",
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

test("model and diagnostic checks fail immediately and retain original evidence", async () => {
  const candidate = Bun.YAML.parse(
    await Bun.file(".github/workflows/behavioral-verification.yml").text(),
  ) as { jobs: Record<string, WorkflowJob> };
  const steps = candidate.jobs.shards.steps;
  expect(steps.some((step) => step.name?.includes("Retry"))).toBe(false);
  expect(steps.some((step) => step["continue-on-error"])).toBe(false);
  expect(
    steps.filter((step) => step.run?.includes("ci-model-groups.ts run")),
  ).toHaveLength(1);
  expect(
    steps.filter(
      (step) => step.run === "bun run verification:diagnostic-control",
    ),
  ).toHaveLength(1);
  const artifact = steps.find(
    (step) => step.name === "Retain source-bound evidence manifests",
  )!;
  expect(artifact.if).toBe("always()");
  expect((artifact.with as { path: string }).path).toContain(
    ".agents/verification/runs/",
  );
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
});

test("release package verification extracts into a temp folder tar would unescape", () => {
  // Windows RUNNER_TEMP is D:\a\_temp: GNU tar unescapes a -C argument, so
  // "\a" became a bell character and extraction failed with "Cannot open".
  const root = mkdtempSync(join(tmpdir(), "verify-release-package-"));
  try {
    const version = "0.0.1-test";
    const platform = "windows-x64";
    const pkg = join(root, "stage", `herdr-world-${platform}`);
    mkdirSync(join(pkg, "LICENSES"), { recursive: true });
    writeFileSync(join(pkg, "VERSION"), `herdr-world ${version} ${platform}\n`);
    for (const legal of [
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
      "DEPENDENCY_NOTICES.md",
      "DEPENDENCY_LICENSES.md",
      "UPSTREAM.md",
      "LICENSES/CLAW-EMPIRE-APACHE-2.0.txt",
    ])
      writeFileSync(join(pkg, legal), "synthetic\n");
    // Minimal PE32+ header for x64: DOS stub pointing at a PE signature.
    const exe = new Uint8Array(0x100);
    const view = new DataView(exe.buffer);
    exe.set([0x4d, 0x5a]);
    view.setUint32(0x3c, 0x80, true);
    view.setUint32(0x80, 0x50450000);
    view.setUint16(0x84, 0x8664, true);
    view.setUint16(0x98, 0x20b, true);
    writeFileSync(join(pkg, "herdr-world.exe"), exe);
    const dist = join(root, "dist");
    mkdirSync(dist);
    const versioned = `herdr-world-v${version}-${platform}.tar.xz`;
    const latest = `herdr-world-${platform}.tar.xz`;
    const run = (cmd: string[], cwd: string) => {
      const result = Bun.spawnSync(cmd, { cwd, stderr: "pipe" });
      expect(result.stderr.toString()).not.toContain("Cannot open");
      expect(result.exitCode).toBe(0);
      return result.stdout.toString();
    };
    run(
      ["tar", "-cJf", join(dist, versioned), `herdr-world-${platform}`],
      join(root, "stage"),
    );
    run(["cp", versioned, latest], dist);
    const digest = new Bun.CryptoHasher("sha256")
      .update(readFileSync(join(dist, latest)))
      .digest("hex");
    for (const archive of [versioned, latest])
      writeFileSync(join(dist, `${archive}.sha256`), `${digest}  ${archive}\n`);
    writeFileSync(
      join(dist, `herdr-world-${platform}.update.json`),
      `${JSON.stringify({ schema: 1, name: "herdr-world", version, platform, archive: latest, sha256: digest })}\n`,
    );
    const runnerTemp = join(root, "D:\\a\\_temp");
    mkdirSync(runnerTemp);
    const script = new URL("./verify-release-package.sh", import.meta.url)
      .pathname;
    const result = Bun.spawnSync(["bash", script, version, platform], {
      cwd: root,
      env: { ...process.env, RUNNER_TEMP: runnerTemp },
      stderr: "pipe",
    });
    expect(result.stderr.toString()).not.toContain("Cannot open");
    expect(result.exitCode).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Static checks retain concurrent command logs even after failure", () => {
  const job = workflow.jobs["unit-tests"];
  expect(workflow.jobs.static.if).toBe(
    "needs.validation-scope.outputs.mode == 'docs'",
  );
  expect(job.strategy?.["fail-fast"]).toBe(false);
  expect(
    job.strategy?.matrix?.include?.map((row) => row.group).filter(Boolean),
  ).toEqual(["types", "build", "repository"]);
  expect(job.needs).toBe("validation-scope");
  expect(job["continue-on-error"] ?? false).toBe(false);
  expect(
    job.steps.find((step) => step.uses?.startsWith("actions/checkout@"))?.with,
  ).toMatchObject({ "persist-credentials": false });
  expect(
    job.steps.find((step) => step.name === "Fetch history for static ratchets"),
  ).toMatchObject({
    if: "${{ !cancelled() && matrix.group != '' }}",
    run: "git fetch --filter=blob:none --unshallow origin",
  });
  expect(
    job.steps.find(
      (step) =>
        step.run === "bun run check:static --static-group=${{ matrix.group }}",
    ),
  ).toMatchObject({
    if: "${{ !cancelled() && matrix.group != '' }}",
  });
  expect(
    job.steps.filter(
      (step) =>
        step["continue-on-error"] && !/retry|flaky/i.test(step.name || ""),
    ),
  ).toHaveLength(0);
  expect(
    job.steps.find((step) => step.name === "Upload static check logs"),
  ).toMatchObject({
    if: "always() && matrix.group != ''",
    uses: "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9",
    with: {
      name: "static-check-logs-${{ matrix.group }}",
      path: ".agents/delivery/lanes/static-*.log",
      "include-hidden-files": true,
      "if-no-files-found": "error",
    },
  });
});
