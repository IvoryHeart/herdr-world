import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "../world/board-store";
import { handleWorldRpc } from "./world";
import type { BridgeRpcContext } from "./context";
import { BoardDocumentStore } from "../../../web/src/world/board/boardDocument";

const directories: string[] = [];
afterEach(() =>
  directories
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true })),
);
test("browser Group confirmations bind the reviewed Board revision through the real RPC adapter", async () => {
  const directory = mkdtempSync(join(tmpdir(), "group-revision-"));
  directories.push(directory);
  const board = new BoardStore(join(directory, "board.json"));
  const published: number[] = [];
  const client = new BoardDocumentStore({
    onControl: () => () => {},
    onStatus: () => () => {},
    call: async (method, params) => {
      let result: unknown;
      await handleWorldRpc({
        method,
        params,
        id: "group-edit",
        services: {
          board: () => board,
          publishBoardChanged: (revision: number) => published.push(revision),
          bindBoardRecipients: async () => {},
          logger: { warn: () => {} },
        },
        sendReply: (reply: { result: unknown }) => {
          result = reply.result;
          return true;
        },
        sendError: (_method: string, error: unknown) => {
          throw error;
        },
      } as unknown as BridgeRpcContext);
      return result;
    },
  });
  await client.refresh();
  expect(
    await client.patch(
      [{ op: "group.create", id: "chat", kind: "pod", name: "Chat" }],
      0,
    ),
  ).toBeNull();
  const reviewed = client.get().document!.revision;
  board.patch([{ op: "group.set_attrs", id: "chat", name: "New name" }]);
  expect(
    await client.patch([{ op: "group.delete", id: "chat" }], reviewed),
  ).toContain("changed");
  expect(board.get().relations.groups[0]!.name).toBe("New name");
  expect(client.get().document!.revision).toBe(board.get().revision);
  expect(published).toEqual([1]);
});

test("revision-bound Group and qualified appearance writes share the browser queue", async () => {
  const directory = mkdtempSync(join(tmpdir(), "group-appearance-queue-"));
  directories.push(directory);
  const board = new BoardStore(join(directory, "board.json"));
  const held = Promise.withResolvers<unknown>();
  const calls: { method: string; params?: Record<string, unknown> }[] = [];
  const client = new BoardDocumentStore({
    onControl: () => () => {},
    onStatus: () => () => {},
    call: async (method, params) => {
      if (method === "world.board.get") return board.get();
      calls.push({ method, params });
      return method === "world.board.patch"
        ? held.promise
        : { document: board.get() };
    },
  });
  await client.refresh();
  const group = client.patch(
    [{ op: "group.create", id: "chat", kind: "pod", name: "Chat" }],
    0,
  );
  const target = {
    connection_id: "connection-a",
    connection_generation: 1,
    kind: "tab" as const,
    native_id: "tab-1",
    witness: ["terminal-1"],
    color_key: "connection-a:tab-1",
  };
  const appearance = client.appearance(target, { status: "Ready" });
  await Promise.resolve();
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    method: "world.board.patch",
    params: { revision: 0 },
  });
  held.resolve({
    document: board.patch([
      { op: "group.create", id: "chat", kind: "pod", name: "Chat" },
    ]),
  });
  expect(await group).toBeNull();
  expect(await appearance).toBeNull();
  expect(calls[1]).toEqual({
    method: "world.appearance.patch",
    params: { ...target, fields: { status: "Ready" } },
  });
});
