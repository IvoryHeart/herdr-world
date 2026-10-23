import { expect, test } from "bun:test";
import {
  parseWorldArgs,
  runWorldCommand,
  worldCommands,
  type WorldCliTransport,
} from "./world";
import type { CliContext } from "./command";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("group verbs and pod/team aliases preserve explicit kind and intent", () => {
  expect(parseWorldArgs("pod", ["create", "Chat"])).toMatchObject({
    command: "group create",
    params: { name: "Chat", kind: "pod" },
  });
  expect(parseWorldArgs("team", ["add", "Pair", "builder"])).toMatchObject({
    command: "group add",
    params: { group: "Pair", agent: "builder", kind: "team" },
  });
  expect(
    parseWorldArgs("group", ["list", "--kind", "room", "--json"]),
  ).toMatchObject({
    command: "group list",
    params: { kind: "room" },
    json: true,
  });
  expect(
    parseWorldArgs("pod", ["lead", "Chat", "builder", "--replace", "--yes"]),
  ).toMatchObject({
    command: "group lead",
    params: { replace: true, confirmed: true },
  });
  expect(
    parseWorldArgs("pod", ["reviewers", "Chat", "one", "two"]),
  ).toMatchObject({
    command: "group reviewers",
    params: { agents: ["one", "two"] },
  });
  expect(
    parseWorldArgs("pod", ["now", "Chat", "Review first", "Ship"]),
  ).toMatchObject({
    command: "group now",
    params: { items: ["Review first", "Ship"] },
  });
  expect(
    parseWorldArgs("group", [
      "add",
      "room:connection-a/workshop",
      "one",
      "--herdr",
      "--allow-close-room",
    ]),
  ).toMatchObject({ params: { herdr: true, allow_close_room: true } });
  expect(worldCommands().map((command) => command.name)).toEqual(
    expect.arrayContaining(["group", "pod", "team"]),
  );
});

test("promotion uses JSON mapping without guessing refs or kind", () => {
  const mapping = [
    {
      from: { connection_id: "connection-a", terminal_id: "terminal-1" },
      to: "agent://connection-a/builder",
      roles: ["lead"],
    },
  ];
  expect(
    parseWorldArgs("team", [
      "promote",
      "Pair",
      "--name",
      "Chat",
      "--mapping",
      JSON.stringify(mapping),
    ]),
  ).toMatchObject({
    command: "group promote",
    params: { mapping, name: "Chat", kind: "team" },
  });
});

test("aliases and transfer flags cannot silently change their meaning", () => {
  expect(() =>
    parseWorldArgs("pod", ["create", "Chat", "--kind", "team"]),
  ).toThrow("alias");
  expect(() =>
    parseWorldArgs("pod", ["lead", "Chat", "one", "--replace"]),
  ).toThrow("--yes");
  expect(() => parseWorldArgs("group", ["create", "Chat"])).toThrow("--kind");
  expect(() =>
    parseWorldArgs("group", [
      "promote",
      "Pair",
      "--name",
      "Chat",
      "--mapping",
      "oops",
    ]),
  ).toThrow("JSON");
  expect(() => parseWorldArgs("pod", ["merge", "Chat"])).toThrow("verbs");
});

test("the CLI prints the full preview before executing and never retries Unknown", async () => {
  const order: string[] = [];
  const out: string[] = [];
  const context = {
    log: (text: string) => {
      order.push(text);
      out.push(text);
    },
    error: (text: string) => order.push(text),
  } as unknown as CliContext;
  let calls = 0;
  const transport: WorldCliTransport = async (_command, params) => {
    calls++;
    if (params.preview)
      return {
        ok: true,
        result: {
          status: "preview",
          plan: "a".repeat(64),
          summary: "Moves desk Shared (3 agents: a, b, c) to room Workshop",
        },
      };
    expect(order[0]).toBe(
      "Moves desk Shared (3 agents: a, b, c) to room Workshop",
    );
    expect(params.expected_plan).toBe("a".repeat(64));
    return {
      ok: false,
      code: "unavailable",
      error: "Unknown · observed a at desk t2. Do not retry automatically.",
      result: { status: "failed", topology_known: false },
    };
  };
  expect(
    await runWorldCommand(
      "group",
      ["add", "Workshop", "a", "--herdr", "--json"],
      context,
      transport,
      true,
    ),
  ).toBe(1);
  expect(calls).toBe(2);
  expect(out).toHaveLength(1);
  expect(JSON.parse(out[0]!)).toMatchObject({
    ok: false,
    result: { topology_known: false },
  });
});

test("an unavailable preview never sends a mutation", async () => {
  let calls = 0;
  const context = { log: () => {}, error: () => {} } as unknown as CliContext;
  expect(
    await runWorldCommand(
      "group",
      ["add", "Workshop", "a", "--herdr"],
      context,
      async () => {
        calls++;
        return { ok: false, code: "refused", error: "no current topology" };
      },
      true,
    ),
  ).toBe(3);
  expect(calls).toBe(1);
});

test("Markdown export remains Markdown when piped and import reads only its explicit file", async () => {
  const directory = mkdtempSync(join(tmpdir(), "group-import-"));
  try {
    const file = join(directory, "pods.md");
    const markdown =
      "| Pod | Lead | Builders | Reviewers |\n|---|---|---|---|\n| Chat | a | b | c |";
    writeFileSync(file, markdown);
    const out: string[] = [];
    const context = {
      log: (line: string) => out.push(line),
      error: () => {},
    } as unknown as CliContext;
    const sent: unknown[] = [];
    const transport: WorldCliTransport = async (command, params) => {
      sent.push({ command, params });
      return {
        ok: true,
        result: command === "group list" ? [] : { imported: [] },
      };
    };
    expect(
      await runWorldCommand(
        "group",
        ["list", "--kind", "pod", "--markdown"],
        context,
        transport,
        false,
      ),
    ).toBe(0);
    expect(out[0]).toStartWith("| Pod | Lead |");
    expect(
      await runWorldCommand(
        "pod",
        ["import", file, "--yes", "--connection", "connection-a"],
        context,
        transport,
        true,
      ),
    ).toBe(0);
    expect(sent[1]).toEqual({
      command: "group import",
      params: {
        kind: "pod",
        confirmed: true,
        connection: "connection-a",
        markdown,
      },
    });
    await expect(
      runWorldCommand("pod", ["import", file], context, transport, true),
    ).rejects.toThrow("--yes");
    expect(() =>
      parseWorldArgs("pod", ["list", "--markdown", "--json"]),
    ).toThrow("choose");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
