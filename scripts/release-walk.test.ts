import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestCli } from "../server/src/cli/test-context";
import { runWorldCommand } from "../server/src/cli/world";
import { BoardStore } from "../server/src/world/board-store";
import { createWorldCli } from "../server/src/world/world-cli";
import { WorldLedger } from "../server/src/world/world-ledger";
import { releaseWalk } from "./release-walk";

test("listing repetition input is bounded before any runtime is started", async () => {
  for (const count of ["-1", "101", "1.5", "twenty", "1; echo unsafe"])
    await expect(
      releaseWalk(["--disposable-host", `--listing-repetitions=${count}`]),
    ).rejects.toThrow("Listing repetitions must be an integer from 0 to 100");
});

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
  expect(result.stderr.toString()).toContain("Ran 40 tests");
  expect(result.exitCode).toBe(0);
});

test("listing journey consumes JSON emitted by the current service and CLI", async () => {
  const cli = createTestCli();
  try {
    const connections = ["herdr", "herdr-core"].map((runtime) => ({
      connection_id: runtime,
      label: runtime,
      source: "test",
      is_default: runtime === "herdr",
      state: "ready" as const,
      generation: 1,
      snapshot_generation: 1,
      stale: false,
      actionable: true,
      snapshot: {
        workspaces: [{ workspace_id: `${runtime}-room` }],
        tabs: [{ tab_id: `${runtime}-tab`, workspace_id: `${runtime}-room` }],
        panes: ["claude", "codex"].map((kind) => ({
          workspace_id: `${runtime}-room`,
          tab_id: `${runtime}-tab`,
          pane_id: `${runtime}-${kind}-pane`,
          terminal_id: `${runtime}-${kind}-terminal`,
          agent: kind,
        })),
        agents: ["claude", "codex"].map((kind) => ({
          pane_id: `${runtime}-${kind}-pane`,
        })),
        coverage: {} as never,
        watch_admission: {} as never,
      },
    }));
    const service = createWorldCli({
      board: new BoardStore(join(cli.home, "board.json")),
      ledger: new WorldLedger(join(cli.home, "ledger.json")),
      hosts: () => [],
      defaultConnectionId: () => "herdr",
      snapshot: async () => ({
        revision: 1,
        observed_at: 1,
        hosts: [],
        connections,
      }),
      publishBoard() {},
      publishLedger() {},
    });
    expect(
      await runWorldCommand("ls", ["--json"], cli.context, (command, params) =>
        service.handle({ command, params }, null),
      ),
    ).toBe(0);
    const agents = connections.flatMap((connection) =>
      connection.snapshot.panes.map((pane) => ({
        connection: {
          connection_id: connection.connection_id,
          generation: connection.generation,
        },
        runtime: connection.connection_id,
        kind: pane.agent,
        workspace_id: pane.workspace_id,
        result: pane,
      })),
    );
    const check = Bun.spawnSync(
      [
        "python3",
        "-c",
        `
import json, sys
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0, 'scripts/release-walk')
from journeys_test import JourneyTests
from journeys import listing
value = json.load(sys.stdin)
world = JourneyTests().listing_world(value['rows'])
with patch('journeys.run', return_value=SimpleNamespace(stdout=value['stdout'])):
    listing(world, value['agents'])
`,
      ],
      {
        stdin: Buffer.from(
          JSON.stringify({ rows: connections, agents, stdout: cli.output[0] }),
        ),
        stderr: "pipe",
      },
    );
    expect(check.stderr.toString()).toBe("");
    expect(check.exitCode).toBe(0);
  } finally {
    cli.cleanup();
  }
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
  expect(retained.if).toBe("${{ !inputs.package_artifacts }}");
  const diagnostics = job.steps.find(
    (step: any) =>
      step.with?.name === "release-walk-listing-failure-${{ matrix.platform }}",
  );
  expect(diagnostics.if).toBe("failure()");
  expect(diagnostics.with.path).toBe(
    "${{ runner.temp }}/release-walk/listing-failure.json",
  );
  expect(diagnostics.with["if-no-files-found"]).toBe("ignore");
  expect(step.env.LISTING_REPETITIONS).toBe(
    "${{ inputs.listing_repetitions || 0 }}",
  );
  const batch = job.steps.find(
    (step: any) =>
      step.with?.name === "release-walk-listing-batch-${{ matrix.platform }}",
  );
  expect(batch.if).toBe("always() && inputs.listing_repetitions > 0");
  expect(batch.with["if-no-files-found"]).toBe("error");
});
