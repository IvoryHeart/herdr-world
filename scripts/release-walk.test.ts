import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestCli } from "../server/src/cli/test-context";
import { runWorldCommand } from "../server/src/cli/world";
import { BoardStore } from "../server/src/world/board-store";
import { createWorldCli } from "../server/src/world/world-cli";
import { WorldLedger } from "../server/src/world/world-ledger";
import { isReleaseWalkInput } from "./validation-scope";
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
  expect(result.stderr.toString()).toContain("Ran 42 tests");
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

test("channel rehearsals cannot publish or replace approved Unix release bytes", () => {
  const release = workflow("release");
  expect(release.on.push).toBeUndefined();
  expect(release.on.workflow_dispatch.inputs.dry_run.default).toBe(true);
  const validate = release.jobs.validate;
  const metadata = validate.steps.findIndex(
    (step: any) => step.id === "metadata",
  );
  const gate = validate.steps.findIndex((step: any) => step.id === "walk");
  expect(gate).toBeGreaterThan(metadata);
  expect(validate.steps[gate].env.DRY_RUN).toBe(
    "${{ steps.metadata.outputs.dry_run }}",
  );
  expect(validate.steps[gate].run).toContain('if [ "$DRY_RUN" = true ]; then');
  expect(validate.steps[gate].run).toContain(
    'else\n  bun scripts/release-walk-gate.ts publication "$GITHUB_SHA" "${GITHUB_REF_NAME#v}" "$PUBLISH_RUN_ID"',
  );
  const steps = release.jobs.package.steps;
  const rehearsal = steps.find(
    (step: any) => step.name === "Build Unix channel rehearsal package",
  );
  expect(rehearsal.if).toBe(
    "needs.validate.outputs.dry_run == 'true' && !startsWith(matrix.platform, 'windows-')",
  );
  const approved = steps.find(
    (step: any) =>
      step.with?.name === "release-walk-package-${{ matrix.platform }}",
  );
  expect(approved.if).toBe(
    "needs.validate.outputs.dry_run == 'false' && !startsWith(matrix.platform, 'windows-')",
  );
  for (const name of ["publish", "npm-publish", "homebrew-pr"])
    expect(release.jobs[name].if).toBe(
      "${{ !cancelled() && !failure() && needs.validate.outputs.dry_run == 'false' }}",
    );
});

test("a publication reuses main's evidence and runs main's gate on the tag's code", () => {
  const release = workflow("release");
  const steps = release.jobs.validate.steps;
  const gate = steps.find((step: any) => step.id === "walk");
  const main = steps.find((step: any) => step.with?.ref === "main");
  // Main's gate scripts only, outside the tree the tag's checks scan.
  expect(main.with.path).toBe(".agents/release-gate");
  expect(main.with["sparse-checkout"]).toContain(
    "scripts/release-walk-gate.ts",
  );
  expect(main.with["persist-credentials"]).toBe(false);
  expect(gate["working-directory"]).toBe(main.with.path);
  const tag = steps.find((step: any) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  expect(tag.with.ref).toBeUndefined();
  // The live audit always runs; the repository check and browser tests run
  // only for a rehearsal, because a publication requires main's Delivery checks.
  const audit = steps.find(
    (step: any) => step.run === "bun run security:check",
  );
  expect(audit.if).toBeUndefined();
  const source = steps.find((step: any) => step.run === "bun run check:source");
  expect(source.if).toBe("steps.metadata.outputs.dry_run == 'true'");
  expect(release.jobs["world-browser"].if).toBe(
    "needs.validate.outputs.dry_run == 'true'",
  );
  expect(release.jobs.package.if).toContain(
    "needs.world-browser.result == 'success' || (needs.world-browser.result == 'skipped' && needs.validate.outputs.dry_run == 'false')",
  );
  // A skipped browser job must not skip later jobs; a failure still stops them.
  for (const name of [
    "archives",
    "npm-stage",
    "homebrew-formula",
    "homebrew-smoke",
    "verify",
    "publish",
    "npm-publish",
    "homebrew-pr",
    "deploy-pages",
  ])
    expect(release.jobs[name].if).toStartWith("${{ !cancelled() && !failure()");
});
