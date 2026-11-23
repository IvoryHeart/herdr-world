import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStorage, type WorldStorage } from "../service/storage";
import { resolveDataPaths } from "../config/data-paths";
import { systemClock, systemScheduler } from "../service/ports";
import { createBoardElementService } from "../world/board-element-service";
import { handleWorldRpc } from "./world";
import { createWorldCli, type WorldCliDeps } from "../world/world-cli";
import type { BridgeRpcContext } from "./context";
import { parseWorldArgs, runWorldCommand } from "../cli/world";
import type { CliContext } from "../cli/command";
import { readLocalFile, listLocalFiles } from "../workspace/local-files";

const roots: string[] = [],
  stores: WorldStorage[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "board-elements-rpc-"));
  roots.push(root);
  const storage = await openStorage(
    resolveDataPaths({ HERDR_WORLD_DATA_DIR: root }),
    { clock: systemClock, scheduler: systemScheduler },
  );
  stores.push(storage);
  writeFileSync(join(root, "MEMORY.md"), "Remember the release criteria.");
  const events: number[] = [];
  const elements = createBoardElementService({
    board: storage.board,
    publish: (revision) => events.push(revision),
    project: (source, generation) => {
      expect(source.connection_id).toBe("studio");
      expect(source.workspace_id).toBe("project-a");
      expect(generation).toBe(7);
      return {
        files: {
          readWorkspaceFile: (params) =>
            readLocalFile(root, String(params.path)),
          listWorkspaceFiles: (params) =>
            listLocalFiles(root, String(params.path), true),
        },
        isCurrent: () => true,
      };
    },
  });
  let current = true;
  const call = async (action: string, params: unknown = {}) => {
    let result: any, error: unknown;
    await handleWorldRpc({
      id: "synthetic-request",
      method: `world.board.elements.${action}`,
      params,
      services: { boardElements: elements },
      requestIsCurrent: () => current,
      sendReply: (reply: { result: unknown }) => {
        result = reply.result;
        return true;
      },
      sendError: (_: string, value: unknown) => {
        error = value;
      },
    } as unknown as BridgeRpcContext);
    if (error) throw error;
    return result;
  };
  const cli = createWorldCli({
    hosts: () => [],
    snapshot: async () => ({
      revision: 1,
      observed_at: 1000,
      connections: [
        {
          connection_id: "studio",
          label: "Studio",
          generation: 7,
          snapshot_generation: 7,
          actionable: true,
          stale: false,
          snapshot: {
            workspaces: [{ workspace_id: "project-a", label: "Project" }],
          },
        },
        {
          connection_id: "archive",
          label: "Archive",
          generation: 11,
          snapshot_generation: 10,
          actionable: false,
          stale: true,
        },
      ],
    }),
    board: storage.board(),
    ledger: storage.ledger(),
    elements,
    now: () => 1000,
  } as unknown as WorldCliDeps);
  return {
    storage,
    elements,
    events,
    call,
    cli,
    retire: () => {
      current = false;
    },
  };
}
const doc = {
  id: "draft",
  kind: "document",
  title: "Plan",
  x: 0,
  y: 0,
  source: { text: "Ship the registry" },
};

test("browser RPC and CLI share committed rows, conflict responses and notifications", async () => {
  const f = await fixture();
  expect((await f.call("types")).types).toHaveLength(12);
  const pending = f.call("put", { element: doc });
  expect(f.events).toEqual([]);
  expect(f.storage.board().get().elements).toBeUndefined();
  const saved = await pending;
  expect(saved).toMatchObject({
    status: "saved",
    document: { elements: [{ ...doc, rev: 1 }] },
  });
  expect(f.events).toEqual([1]);
  const list = await f.cli.handle({ command: "board element list" }, null);
  expect(list).toMatchObject({
    ok: true,
    result: { elements: [{ ...doc, rev: 1 }] },
  });
  const update = parseWorldArgs("board", [
    "element",
    "put",
    "document",
    "draft",
    "--title",
    "Plan",
    "--text",
    "Updated",
    "--rev",
    "1",
  ]);
  expect(await f.cli.handle(update, null)).toMatchObject({
    ok: true,
    result: { status: "saved" },
  });
  expect(await f.call("put", { element: doc, rev: 1 })).toMatchObject({
    status: "conflict",
    document: { revision: 2 },
  });
  expect(
    await f.cli.handle(
      { command: "board element delete", params: { id: "draft", rev: 1 } },
      null,
    ),
  ).toMatchObject({
    ok: false,
    code: "refused",
    result: { status: "conflict" },
  });
  expect(await f.call("read", { id: "draft" })).toMatchObject({
    status: "ready",
    content: { text: "Updated" },
  });
  expect(await f.call("delete", { id: "draft", rev: 2 })).toMatchObject({
    status: "saved",
  });
  expect(await f.call("read", { id: "draft" })).toMatchObject({
    status: "unavailable",
    reason: "missing_element",
  });
  f.retire();
  await expect(f.call("put", { element: doc })).rejects.toThrow("current");
  expect(f.events).toEqual([1, 2, 3]);
});

test("real CLI parser and transport produce JSON and meaningful refusal exit codes", async () => {
  const f = await fixture(),
    output: string[] = [];
  const context = {
    runtime: { env: {} },
    log: (line: string) => output.push(line),
    error: (line: string) => output.push(line),
  } as unknown as CliContext;
  const transport = (command: string, params: Record<string, unknown>) =>
    f.cli.handle({ command, params }, null);
  expect(
    await runWorldCommand(
      "board",
      [
        "element",
        "put",
        "document",
        "draft",
        "--title",
        "Plan",
        "--text",
        "CLI draft",
        "--json",
      ],
      context,
      transport,
    ),
  ).toBe(0);
  expect(JSON.parse(output[0]!)).toMatchObject({
    ok: true,
    result: { status: "saved" },
  });
  expect(
    await runWorldCommand(
      "board",
      ["element", "delete", "draft", "--rev", "9", "--json"],
      context,
      transport,
    ),
  ).toBe(3);
  expect(
    await runWorldCommand(
      "board",
      ["element", "read", "missing", "--json"],
      context,
      transport,
    ),
  ).toBe(1);
  for (const args of [
    ["element", "read"],
    ["element", "delete", "draft"],
    ["element", "read", "draft", "--generation", "nan"],
    [
      "element",
      "put",
      "document",
      "draft",
      "--title",
      "Plan",
      "--text",
      "Draft",
      "--at",
      "bad",
    ],
  ])
    expect(() => parseWorldArgs("board", args)).toThrow();
});

test("CLI puts an agent's artefact as a file or link reference", () => {
  const base = ["element", "put", "artefact", "a1", "--title", "Report"];
  const who = [
    "--connection",
    "c1",
    "--workspace",
    "w1",
    "--pane",
    "w1:p2",
    "--agent",
    "claude",
  ];
  expect(
    parseWorldArgs("board", [
      ...base,
      ...who,
      "--path",
      "/work/report.md",
      "--artefact-kind",
      "report",
    ]).params,
  ).toEqual({
    element: {
      id: "a1",
      title: "Report",
      x: 0,
      y: 0,
      kind: "artefact",
      source: {
        connection_id: "c1",
        workspace_id: "w1",
        pane_id: "w1:p2",
        agent: "claude",
        artefact_kind: "report",
        file: "/work/report.md",
      },
    },
  });
  expect(
    parseWorldArgs("board", [...base, ...who, "--url", "https://example.com/r"])
      .params,
  ).toMatchObject({
    element: {
      source: { artefact_kind: "file", url: "https://example.com/r" },
    },
  });
  for (const extra of [
    ["--path", "work/report.md"],
    ["--path", "/work/../x.md"],
    [],
  ])
    expect(() =>
      parseWorldArgs("board", [...base, ...who, ...extra]),
    ).toThrow();
  expect(() =>
    parseWorldArgs("board", [
      ...base,
      "--connection",
      "c1",
      "--workspace",
      "w1",
      "--path",
      "/w/r.md",
    ]),
  ).toThrow();
});

test("CLI ls selectors support successful project reads for every file-backed kind", async () => {
  const f = await fixture();
  const output: string[] = [];
  const context = {
    runtime: { env: {} },
    log: (line: string) => output.push(line),
    error: (line: string) => output.push(line),
  } as unknown as CliContext;
  const transport = (command: string, params: Record<string, unknown>) =>
    f.cli.handle({ command, params }, null);
  const run = async (command: string, args: string[]) => {
    output.length = 0;
    expect(
      await runWorldCommand(command, [...args, "--json"], context, transport),
    ).toBe(0);
    return JSON.parse(output[0]!);
  };
  const listed = await run("ls", []);
  expect(listed.result).toMatchObject([
    { connection_id: "studio", generation: 7, current: true },
    { connection_id: "archive", generation: 11, current: false },
  ]);
  const connection = listed.result.find(
    (row: { current: boolean }) => row.current,
  );
  const workspace = connection.workspaces[0];
  for (const kind of ["memory", "log", "document"]) {
    const id = `project-${kind}`;
    const saved = await run("board", [
      "element",
      "put",
      kind,
      id,
      "--title",
      "Project source",
      "--connection",
      connection.connection_id,
      "--workspace",
      workspace.workspace_id,
      "--path",
      "MEMORY.md",
    ]);
    expect(saved.result.status).toBe("saved");
    const read = await run("board", [
      "element",
      "read",
      id,
      "--generation",
      String(connection.generation),
    ]);
    expect(read.result).toMatchObject({
      status: "ready",
      target: {
        connection_id: connection.connection_id,
        connection_generation: connection.generation,
        workspace_id: workspace.workspace_id,
        path: "MEMORY.md",
      },
      content: { text: "Remember the release criteria.", truncated: false },
    });
  }
});
