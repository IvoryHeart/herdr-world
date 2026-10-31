import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { agentAddress } from "../../../shared/groups";
import { interestKey } from "../../../shared/interest";
import { BoardStore, parseBoardDocument } from "./board-store";
import { BoardDocumentStore } from "../../../web/src/world/board/boardDocument";
import { startAgentChimeInterest } from "../../../web/src/world/useAgentInterest";
import { createChimeCenter } from "../../../web/src/chimes/chimeCenter";

const directories: string[] = [];
afterEach(() =>
  directories
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true })),
);
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "group-interest-"));
  directories.push(directory);
  const path = join(directory, "board.json");
  return { path, board: new BoardStore(path) };
}
test("explicit agent Watching persists separately from Default deletion", () => {
  const { board, path } = setup();
  const key = interestKey("connection-a", "terminal-1");
  board.patch([{ op: "interest.set", key, interest: "watching" }]);
  expect(new BoardStore(path).get().layout.interest[key]).toBe("watching");
  board.patch([{ op: "interest.set", key, interest: null }]);
  expect(new BoardStore(path).get().layout.interest).not.toHaveProperty(key);
});
test("stored Group intent is independent of membership, survives absence and is removed with deletion atomically", () => {
  const { board, path } = setup();
  board.patch([
    {
      op: "group.create",
      id: "chat",
      name: "Chat",
      kind: "pod",
      members: [
        { ref: agentAddress("connection-a", "away"), roles: ["reviewer"] },
      ],
    },
  ]);
  const membership = board.get().relations.groups;
  const focused = board.patch([
    { op: "group.interest", id: "chat", interest: "focused" },
  ]);
  expect(focused.layout.interest).toEqual({});
  expect(focused.relations.groups).toEqual(membership);
  expect(new BoardStore(path).get().layout.group_interest).toEqual({
    chat: "focused",
  });
  const deleted = board.patch([{ op: "group.delete", id: "chat" }]);
  expect(deleted.layout.group_interest).toEqual({});
  expect(deleted.relations.group_changes?.at(-1)).toMatchObject({
    group_id: "chat",
    revision: deleted.revision,
    op: "group.delete",
  });
});
test("promotion keeps a stable overlay; automatic Team dissolution removes it", () => {
  const { board } = setup();
  const refs = ["one", "two"].map((terminal_id) => ({
    connection_id: "connection-a",
    terminal_id,
  }));
  board.patch([
    {
      op: "group.create",
      id: "pair",
      kind: "team",
      members: refs.map((ref) => ({ ref, roles: [] })),
    },
    { op: "group.interest", id: "pair", interest: "muted" },
  ]);
  board.patch([
    {
      op: "group.promote",
      id: "pair",
      name: "Chat",
      mapping: refs.map((from) => ({
        from,
        to: agentAddress("connection-a", from.terminal_id),
        roles: ["builder"],
      })),
    },
  ]);
  expect(board.get().layout.group_interest).toEqual({ pair: "muted" });
  board.patch([
    {
      op: "group.create",
      id: "temporary",
      kind: "team",
      members: refs.map((ref) => ({ ref, roles: [] })),
    },
    { op: "group.interest", id: "temporary", interest: "focused" },
    { op: "group.leave", id: "temporary", refs: [refs[0]!] },
  ]);
  expect(board.get().layout.group_interest).toEqual({ pair: "muted" });
});
test("projected, absent or invalid Group preferences are refused without persisting them", () => {
  const { board } = setup();
  const before = board.get();
  expect(() =>
    board.patch([
      {
        op: "group.interest",
        id: "room:connection-a/room-1",
        interest: "focused",
      },
    ]),
  ).toThrow("stored");
  expect(board.get()).toEqual(before);
  expect(() =>
    parseBoardDocument({
      ...before,
      layout: { ...before.layout, group_interest: { missing: "muted" } },
    }),
  ).toThrow("stored");
  board.patch([{ op: "group.create", id: "chat", name: "Chat", kind: "pod" }]);
  expect(() =>
    parseBoardDocument({
      ...board.get(),
      layout: { ...board.get().layout, group_interest: { chat: "watching" } },
    }),
  ).toThrow("interest");
});
test("opaque Group IDs cannot collide with object prototype names", () => {
  const { board, path } = setup();
  board.patch([
    { op: "group.create", id: "__proto__", name: "Prototype", kind: "pod" },
    { op: "group.interest", id: "__proto__", interest: "focused" },
  ]);
  expect(
    Object.hasOwn(
      new BoardStore(path).get().layout.group_interest!,
      "__proto__",
    ),
  ).toBe(true);
  expect(new BoardStore(path).get().layout.group_interest!["__proto__"]).toBe(
    "focused",
  );
});

test("the production chime-source installer reads live explicit overrides through the real browser Board store", async () => {
  const { board } = setup();
  const key = interestKey("connection-a", "terminal-1");
  board.patch([{ op: "interest.set", key, interest: "muted" }]);
  const browser = new BoardDocumentStore({
    onControl: () => () => {},
    onStatus: () => () => {},
    call: async (method, params) =>
      method === "world.board.get"
        ? board.get()
        : { document: board.patch(params!.ops as never) },
  });
  await browser.refresh();
  const stop = startAgentChimeInterest(browser);
  const played: unknown[] = [];
  const center = () =>
    createChimeCenter({
      now: () => 1_000,
      document: () => null,
      device: () => ({ on: true, volume: 0.5 }),
      ready: () => true,
      play: (...args) => {
        played.push(args);
        return true;
      },
      setTimer: () => 0,
    });
  const change = {
    kind: "completed" as const,
    connectionId: "connection-a",
    terminalId: "terminal-1",
    agent: "codex",
    detail: null,
  };
  try {
    center().announce(change);
    expect(played).toHaveLength(0);
    expect(
      await browser.patch([{ op: "interest.set", key, interest: "watching" }]),
    ).toBeNull();
    center().announce(change);
    expect(played).toHaveLength(1);
  } finally {
    stop();
  }
});
