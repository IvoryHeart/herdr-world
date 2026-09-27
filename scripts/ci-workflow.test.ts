import { expect, test } from "bun:test";

type WorkflowStep = {
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  with?: { "fetch-depth"?: number };
};

type WorkflowJob = {
  name?: string;
  runs_on?: string;
  strategy?: {
    matrix?: {
      include?: Array<{ arch?: string; runner?: string }>;
    };
  };
  steps: WorkflowStep[];
};

const workflow = Bun.YAML.parse(
  await Bun.file(
    new URL("../.github/workflows/ci.yml", import.meta.url),
  ).text(),
) as {
  jobs: Record<string, WorkflowJob>;
};

test("CI exposes the protected delivery gate and runs the complete repository check", () => {
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
