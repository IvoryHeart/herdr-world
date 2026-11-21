import { expect, test } from "bun:test";
import { parseWorldArgs, runWorldCommand } from "./world";
import { createTestCli } from "./test-context";
import { createWorldCli, type WorldCliDeps } from "../world/world-cli";
import { parseAnalyticsQuery } from "../usage/analytics";

test("usage CLI sends one qualified query, refuses unsafe selectors and offers an offline synthetic fixture", async () => {
  expect(
    parseWorldArgs("usage", [
      "--window",
      "7d",
      "--group-by",
      "agent",
      "--connection",
      "alpha",
      "--generation",
      "2",
      "--pane",
      "p1",
    ]),
  ).toMatchObject({
    command: "usage",
    params: {
      window: "7d",
      group_by: "agent",
      connection_id: "alpha",
      connection_generation: 2,
      pane_id: "p1",
    },
  });
  for (const args of [
    ["--window", "all"],
    ["--pane", "p1"],
    ["--generation", "NaN"],
    ["--path", "/synthetic"],
  ])
    expect(() => parseWorldArgs("usage", args)).toThrow();
  const cli = createTestCli();
  try {
    const result = await runWorldCommand(
      "usage",
      ["--fixture", "--json"],
      cli.context,
      async () => {
        throw new Error("must stay offline");
      },
    );
    expect(result).toBe(0);
    expect(JSON.parse(cli.output[0]!).result.total.total_tokens.value).toBe(
      1700,
    );
    cli.output.length = 0;
    await runWorldCommand(
      "usage",
      ["--fixture"],
      cli.context,
      async () => {
        throw new Error("offline");
      },
      true,
    );
    expect(cli.output[0]).toContain("reported USD unknown");
  } finally {
    cli.cleanup();
  }
});
test("authenticated CLI service read uses the same analytics validation and refuses fixture injection", async () => {
  const calls: unknown[] = [];
  const cli = createWorldCli({
    hosts: () => [],
    usage: async (params: Record<string, unknown>) => {
      calls.push(parseAnalyticsQuery(params));
      return { version: 1 };
    },
  } as unknown as WorldCliDeps);
  expect(
    await cli.handle({ command: "usage", params: { group_by: "day" } }, null),
  ).toMatchObject({ ok: true, result: { version: 1 } });
  expect(
    await cli.handle({ command: "usage", params: { fixture: true } }, null),
  ).toMatchObject({ ok: false, code: "usage" });
  expect(calls).toEqual([{ group_by: "day" }]);
});
