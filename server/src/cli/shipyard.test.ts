import { afterEach, expect, test } from "bun:test";
import { createShipyardCommand, shipyardTransport } from "./shipyard";
import { createTestCli, type TestCli } from "./test-context";
import { runCli } from "./index";
import { demoShipyard } from "../shipyard/testing/demo";

let cli: TestCli;
afterEach(() => cli?.cleanup());

test("show and list send only the validated read contract", async () => {
  cli = createTestCli();
  const calls: unknown[] = [];
  const commands = [
    createShipyardCommand(async (_context, action, params) => {
      calls.push({ action, params });
      return { ok: true, result: await demoShipyard("populated") };
    }),
  ];
  expect(
    await runCli(
      ["shipyard", "show", "Example-Org/Widgets", "--refresh", "--json"],
      cli.context,
      commands,
    ),
  ).toBe(0);
  expect(calls).toEqual([
    { action: "show", params: { repo: "example-org/widgets", refresh: true } },
  ]);
  expect(JSON.parse(cli.output[0]!).data.waiting.pullRequests[0].number).toBe(
    42,
  );
  expect(
    await runCli(
      ["shipyard", "tag", "example-org/widgets"],
      cli.context,
      commands,
    ),
  ).toBe(2);
  expect(
    await runCli(
      ["shipyard", "show", "https://github.com/a/b"],
      cli.context,
      commands,
    ),
  ).toBe(2);
  expect(
    await runCli(["shipyard", "list", "--refresh"], cli.context, commands),
  ).toBe(2);
  expect(calls.length).toBe(1);
});

test.each([
  "populated",
  "limited",
  "empty",
  "diverged",
  "old-head",
  "no-actions",
  "offline",
  "stale",
])("demo %s needs no service or credentials", async (scenario) => {
  cli = createTestCli();
  expect(
    await runCli(
      ["shipyard", "demo", "--scenario", scenario, "--json"],
      cli.context,
    ),
  ).toBe(0);
  const snapshot = JSON.parse(cli.output[0]!);
  expect(snapshot.repo).toBe("example-org/widgets");
  expect(snapshot.instances.items[1].openUrl).toBeNull();
  if (scenario === "stale") {
    expect(snapshot.state).toBe("stale");
    expect(snapshot.data.releases.items.length).toBe(2);
  }
  if (scenario === "limited")
    expect(snapshot.data.waiting.complete).toBe(false);
  expect(cli.commands).toEqual([]);
});

test("human output names incomplete evidence and safe links", async () => {
  cli = createTestCli();
  expect(
    await runCli(["shipyard", "demo", "--scenario", "limited"], cli.context),
  ).toBe(0);
  expect(cli.output[0]).toContain("limited");
  expect(cli.output[0]).toContain("observed workflows");
  expect(cli.output[0]).toContain("http://127.0.0.1:19091/");
  expect(cli.output[0]).not.toContain("http://127.0.0.1:19092/");
});

test("the native transport refuses non-loopback endpoints before sending a token", async () => {
  cli = createTestCli({
    runtime: {
      env: {
        HERDR_WORLD_URL: "https://example.com",
        HERDR_WORLD_TOKEN: "synthetic-token",
      },
    },
  });
  await expect(shipyardTransport(cli.context, "list", {})).rejects.toThrow(
    "loopback",
  );
});
