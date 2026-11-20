import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseMemoryArgs, MEMORY_HELP } from "./memory";
import { createTestCli, type TestCli } from "./test-context";
import { parseWorldArgs, runWorldCommand } from "./world";
import { runCli } from "./index";
import { MEMORY_LIMITS } from "../../../shared/memory";

const fixtures: TestCli[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});
const target = ["--connection", "example", "--generation", "7"];

test("CLI requires observed identity, explicit writes, revision and deletion confirmation", () => {
  expect(() => parseMemoryArgs(["list"])).toThrow("--generation");
  expect(() =>
    parseMemoryArgs(["list", "--connection", "example", "--generation", "no"]),
  ).toThrow("integer");
  expect(
    parseWorldArgs("memory", ["search", "needle", ...target, "--agent", "p1"]),
  ).toMatchObject({
    command: "memory search",
    params: {
      query: "needle",
      connection_id: "example",
      connection_generation: 7,
      agent_id: "p1",
    },
    json: true,
  });
  expect(() =>
    parseMemoryArgs([
      "delete",
      ...target,
      "--source",
      "s",
      "--path",
      "note.md",
      "--revision",
      "a",
      "--user-action",
    ]),
  ).toThrow("--yes");
  expect(() =>
    parseMemoryArgs([
      "update",
      ...target,
      "--source",
      "s",
      "--path",
      "note.md",
    ]),
  ).toThrow("--user-action");
  expect(
    parseMemoryArgs([
      "delete",
      ...target,
      "--source",
      "s",
      "--path",
      "note.md",
      "--revision",
      "a",
      "--user-action",
      "--yes",
    ]).params,
  ).toMatchObject({ user_action: true, confirmed: true, revision: "a" });
});

test("CLI sends UTF-8 file contents to the common authenticated transport and emits JSON receipts", async () => {
  const f = createTestCli();
  fixtures.push(f);
  const file = join(f.home, "input.md");
  writeFileSync(file, "A synthetic memory\n");
  const calls: unknown[] = [];
  expect(
    await runWorldCommand(
      "memory",
      [
        "create",
        ...target,
        "--source",
        "s",
        "--path",
        "note.md",
        "--file",
        file,
        "--user-action",
      ],
      f.context,
      async (command, params) => {
        calls.push({ command, params });
        return { ok: true, result: { status: "created" } };
      },
    ),
  ).toBe(0);
  expect(calls).toEqual([
    {
      command: "memory create",
      params: {
        connection_id: "example",
        connection_generation: 7,
        source_id: "s",
        path: "note.md",
        user_action: true,
        content: "A synthetic memory\n",
      },
    },
  ]);
  expect(JSON.parse(f.output[0]!)).toMatchObject({
    ok: true,
    result: { status: "created" },
  });
  writeFileSync(file, "x".repeat(MEMORY_LIMITS.file_bytes + 1));
  expect(() =>
    parseMemoryArgs([
      "create",
      ...target,
      "--source",
      "s",
      "--path",
      "note.md",
      "--file",
      file,
      "--user-action",
    ]),
  ).toThrow("256 KiB");
  writeFileSync(file, Buffer.from([0xff]));
  expect(() =>
    parseMemoryArgs([
      "create",
      ...target,
      "--source",
      "s",
      "--path",
      "note.md",
      "--file",
      file,
      "--user-action",
    ]),
  ).toThrow("UTF-8");
});

test("top-level help exposes the memory contract without starting a service", async () => {
  const f = createTestCli();
  fixtures.push(f);
  expect(await runCli(["memory", "--help"], f.context)).toBe(0);
  expect(f.output.join("\n")).toContain(MEMORY_HELP);
});

test("testing-only demo exercises rare states and CRUD without a running service or user files", async () => {
  const f = createTestCli();
  fixtures.push(f);
  expect(await runCli(["memory", "demo", "--json"], f.context)).toBe(0);
  expect(JSON.parse(f.output[0]!)).toMatchObject({
    fixture: true,
    shared_agents: ["p1", "p2"],
    opencode_sources: [
      {
        name: "AGENTS.md",
        scope: "user",
        kind: "instructions",
        load: "startup-candidate",
        description: "OpenCode user instructions",
      },
      {
        name: "AGENTS.md",
        scope: "project",
        kind: "instructions",
        load: "startup-candidate",
        description: "OpenCode ancestor instructions",
      },
    ],
    unsupported_sources: 0,
    stale: true,
    created: "created",
    updated: "updated",
    deleted: "deleted",
    stale_revision: "conflict",
    unconfirmed_delete: "refused",
    truncated: true,
    cleaned_up: true,
  });
});
