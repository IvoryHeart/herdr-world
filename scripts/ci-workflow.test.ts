import { expect, test } from "bun:test";

type WorkflowStep = {
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  with?: { "fetch-depth"?: number; ref?: string };
};

type WorkflowJob = {
  name?: string;
  runs_on?: string;
  strategy?: {
    matrix?: {
      include?: Array<{ arch?: string; runner?: string }>;
      platform?: string[];
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
  expect(delivery?.steps.some((step) => step.run === "bun run check")).toBe(
    true,
  );
  expect(
    delivery?.steps.find((step) => step.run === "bun run check"),
  ).toMatchObject({
    name: "Run full repository check",
    if: "steps.scope.outputs.mode != 'docs' && steps.scope.outputs.mode != 'reuse'",
  });
  expect(
    delivery?.steps.find((step) => step.run === "bun run check:docs")?.if,
  ).toBe("steps.scope.outputs.mode == 'docs'");
  expect(
    delivery?.steps.find((step) => step.name === "Determine validation scope")
      ?.run,
  ).toBe("bun scripts/ci-reuse-full-check.ts");
  expect(
    delivery?.steps.find((step) => step.name === "Check knowledge-map impact"),
  ).toMatchObject({
    if: "github.event_name == 'pull_request'",
    run: 'bun scripts/check-knowledge-map.ts "$GITHUB_EVENT_PATH"',
  });
  expect(
    delivery?.steps.find((step) => step.uses?.startsWith("actions/checkout@"))
      ?.with?.["fetch-depth"],
  ).toBe(0);
  expect(workflow.jobs.validate).toBeUndefined();
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
