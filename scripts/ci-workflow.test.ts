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
  const delivery = workflow.jobs.delivery;

  expect(delivery?.name).toBe("Delivery checks");
  expect(delivery?.steps.some((step) => step.run === "bun run check")).toBe(
    true,
  );
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
  expect(lifecycle).toContain("bun scripts/world-plugin.ts start");
  expect(lifecycle).toContain("bun scripts/world-plugin.ts status");
  expect(lifecycle).toContain("bun scripts/world-plugin.ts restart");
  expect(lifecycle).toContain("bun scripts/world-plugin.ts uninstall");
  expect(lifecycle).toContain("http://127.0.0.1:8787/healthz");
  expect(lifecycle).toContain("trap cleanup EXIT");
});
