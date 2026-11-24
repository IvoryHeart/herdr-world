import { expect, test } from "bun:test";
import { parseWorldArgs, runWorldCommand } from "./world";
import { createTestCli } from "./test-context";

test("runtime and agent reads parse into typed World commands", () => {
  expect(parseWorldArgs("runtime", ["ls", "--json"])).toEqual({
    command: "runtime ls",
    params: {},
    json: true,
  });
  expect(
    parseWorldArgs("agent", ["ls", "--connection", "core-a"]),
  ).toMatchObject({ command: "agent ls", params: { connection: "core-a" } });
  expect(
    parseWorldArgs("agent", ["read", "core-a/t2", "--lines", "20"]),
  ).toMatchObject({
    command: "agent read",
    params: { target: "core-a/t2", lines: 20 },
  });
  for (const args of [
    ["read"],
    ["read", "t2", "--lines", "0"],
    ["read", "t2", "--lines", "1.5"],
    ["send", "t2"],
    ["ls", "extra"],
  ])
    expect(() => parseWorldArgs("agent", args)).toThrow();
});

test("agent read prints screen text even when piped, with explicit JSON available", async () => {
  const cli = createTestCli();
  try {
    const transport = async () => ({
      ok: true,
      result: { target: "core-a/t2", text: "first\nlast" },
    });
    expect(
      await runWorldCommand(
        "agent",
        ["read", "core-a/t2"],
        cli.context,
        transport,
        false,
      ),
    ).toBe(0);
    expect(cli.output).toEqual(["first\nlast"]);
    await runWorldCommand(
      "agent",
      ["read", "core-a/t2", "--json"],
      cli.context,
      transport,
      false,
    );
    expect(JSON.parse(cli.output[1]!).result.target).toBe("core-a/t2");
  } finally {
    cli.cleanup();
  }
});

test("human runtime and agent lists include capability, actionability and status", async () => {
  const cli = createTestCli();
  try {
    await runWorldCommand(
      "runtime",
      ["ls"],
      cli.context,
      async () => ({
        ok: true,
        result: {
          connections: [
            {
              host_id: "local",
              host_label: "This computer",
              connection_id: "core-a",
              kind: "herdr-core",
              version: "0.1.21",
              state: "ready",
              actionable: true,
              agent_verbs: ["ls", "read"],
              manual: "hc --skill",
            },
          ],
        },
      }),
      true,
    );
    expect(cli.output[0]).toContain("This computer");
    expect(cli.output[0]).toContain("core-a: herdr-core 0.1.21");
    expect(cli.output[0]).toContain(
      "actionable; agent verbs: ls, read; manual: hc --skill",
    );
    await runWorldCommand(
      "agent",
      ["ls"],
      cli.context,
      async () => ({
        ok: true,
        result: {
          agents: [
            {
              target: "core-a/t2",
              status: "idle",
              name: "Builder",
              agent: "codex",
            },
          ],
        },
      }),
      true,
    );
    expect(cli.output[1]).toBe("core-a/t2\tidle\tBuilder");
  } finally {
    cli.cleanup();
  }
});
