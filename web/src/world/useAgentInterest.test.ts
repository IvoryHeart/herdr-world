import { describe, expect, test } from "bun:test";
import { interestKey } from "../../../shared/interest";
import type { Pane } from "../types";
import type { WorldRuntimeConnection, WorldRuntimeState } from "./runtimeStore";
import {
  agentInterest,
  focusReachable,
  keepInterests,
  liveTerminalKeys,
  createAgentInterestReader,
} from "./useAgentInterest";
import type { BoardDocument } from "./board/boardDocument";
import { agentAddress } from "../../../shared/groups";

const pane = (terminal_id: string) => ({ terminal_id }) as Pane;
const connection = (
  connectionId: string,
  terminals: string[],
  ready = true,
): WorldRuntimeConnection =>
  ({
    connectionId,
    state: ready ? "ready" : "reconnecting",
    actionable: ready,
    stale: !ready,
    snapshot: { panes: terminals.map(pane) },
  }) as unknown as WorldRuntimeConnection;
const world = (...connections: WorldRuntimeConnection[]) =>
  ({ connections }) as WorldRuntimeState;

describe("agent interest for chimes", () => {
  test("an agent without a record is watching", () => {
    const some = agentInterest(
      { [interestKey("conn-a", "term_1")]: "muted" },
      false,
    );
    expect(some.interestOf("conn-a", "term_1")).toBe("muted");
    expect(some.interestOf("conn-a", "term_2")).toBe("watching");
  });

  test("a focus counts only while World can reach its terminal", () => {
    const focused = { [interestKey("conn-b", "term_1")]: "focused" as const };
    const online = liveTerminalKeys(world(connection("conn-b", ["term_1"])));
    expect(focusReachable(focused, online)).toBe(true);
    // Its host offline, removed, or the terminal gone: other agents chime.
    const offline = world(connection("conn-b", ["term_1"], false));
    expect(focusReachable(focused, liveTerminalKeys(offline))).toBe(false);
    expect(focusReachable(focused, liveTerminalKeys(world()))).toBe(false);
    const gone = world(connection("conn-b", ["term_2"]));
    expect(focusReachable(focused, liveTerminalKeys(gone))).toBe(false);
    // A mute never gates anyone.
    const muted = { [interestKey("conn-b", "term_1")]: "muted" as const };
    expect(focusReachable(muted, online)).toBe(false);
  });

  test("records keep their identity until one changes", () => {
    const last = { a: "muted" as const };
    expect(keepInterests(last, { a: "muted" })).toBe(last);
    const next = { a: "focused" as const };
    expect(keepInterests(last, next)).toBe(next);
  });
});

test("the live reader follows address restarts, effective focus union and explicit Watch without copying terminal intent", () => {
  let document = {
    version: 1,
    revision: 1,
    layout: {
      anchors: {},
      offsets: {},
      pinned: {},
      folded: [],
      interest: {},
      group_interest: { chat: "focused" },
    },
    notes: [],
    strings: [],
    relations: {
      spawns: [],
      groups: [
        {
          id: "chat",
          name: "Chat",
          kind: "pod",
          created_at: 1,
          members: [
            {
              ref: agentAddress("connection-a", "builder"),
              roles: ["builder"],
              joined_at: 1,
            },
          ],
        },
      ],
    },
  } as BoardDocument;
  const current = (
    terminal = "terminal-1",
    name = "builder",
  ): WorldRuntimeConnection => ({
    ...connection("connection-a", [terminal]),
    generation: 1,
    snapshotGeneration: 1,
    snapshot: {
      workspaces: [
        {
          workspace_id: "room-1",
          label: "Room",
          number: 1,
          focused: false,
          pane_count: 1,
          tab_count: 1,
          agent_status: "working",
        },
      ],
      tabs: [],
      panes: [
        {
          pane_id: "pane-1",
          terminal_id: terminal,
          tab_id: "tab-1",
          workspace_id: "room-1",
          agent: "codex",
        } as Pane,
      ],
      agents: [
        { pane_id: "pane-1", terminal_id: terminal, agent: "codex", name },
      ],
    },
  });
  let observed = world(current());
  const reader = createAgentInterestReader(
    { get: () => ({ document, error: null }), subscribe: () => () => true },
    { get: () => observed, subscribe: () => () => true },
  );
  const focused = reader.get();
  expect(focused.interestOf("connection-a", "terminal-1")).toBe("focused");
  expect(focused.anyFocused).toBe(true);
  document = { ...structuredClone(document), revision: 2 };
  expect(reader.get()).toBe(focused); // unrelated Board changes keep the consumer snapshot.
  document.layout.interest = {
    [interestKey("connection-a", "terminal-1")]: "watching",
  };
  // Board updates replace document identity, as the actual store does.
  document = { ...document };
  expect(reader.get().anyFocused).toBe(false);
  expect(reader.get().overrideOf("connection-a", "terminal-1")).toBe(
    "watching",
  );
  observed = world(current("replacement-terminal"));
  expect(reader.get().interestOf("connection-a", "replacement-terminal")).toBe(
    "focused",
  );
  expect(reader.get().anyFocused).toBe(true);
  expect(document.layout.interest).not.toHaveProperty(
    interestKey("connection-a", "replacement-terminal"),
  );
  observed = world({
    ...current("replacement-terminal"),
    actionable: false,
    stale: true,
  });
  expect(reader.get().anyFocused).toBe(false);
});

test.each([
  ["default", undefined, "watching"],
  ["mute", "muted", "muted"],
  ["explicit Watch", "watching", "watching"],
] as const)(
  "%s without Focus does not enumerate runtime panes",
  (_label, override, expected) => {
    let reads = 0;
    const observed = connection("connection-a", ["terminal-1"]);
    Object.defineProperty(observed, "snapshot", {
      get() {
        reads++;
        return { panes: [pane("terminal-1")] };
      },
    });
    const document = {
      layout: {
        interest: override
          ? {
              [interestKey("connection-a", "terminal-1")]: override,
            }
          : {},
      },
    } as BoardDocument;
    const reader = createAgentInterestReader(
      { get: () => ({ document, error: null }), subscribe: () => () => true },
      { get: () => world(observed), subscribe: () => () => true },
    );
    const policy = reader.get();
    expect(policy.anyFocused).toBe(false);
    expect(policy.interestOf("connection-a", "terminal-1")).toBe(expected);
    expect(reads).toBe(0);
  },
);
