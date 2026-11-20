import { afterEach, expect, test } from "bun:test";
import { bridge } from "../../api";
import { NO_TRACE } from "../devtools/flag";
import {
  projectWorldOffice,
  TOWN_PRESENTATION_BOUNDS,
} from "../herdrOfficeProjection";
import type { WorldRuntimeConnection } from "../runtimeStore";
import { buildWorldObject } from "../worldObject";
import { townDragFor, townDropTarget } from "./townDrag";
import { townModelFromProjection } from "./townModel";
import { townMoveActions } from "./townMoveActions";
import { sharedBoardStore, type BoardOp } from "../board/boardDocument";
import type { DeskPins } from "../useDeskPins";
import { townDeskColorTarget } from "./townModel";
import { terminalColorKey } from "../terminalColor";

const connection = bridge.connection;
const call = bridge.call;
afterEach(() => {
  bridge.connection = connection;
  bridge.call = call;
});

/** Core rows also exercised through the real provider in server's town-moves test. */
async function setup() {
  const addresses = ["t1", "t2", "t3"];
  const tabs = addresses.map((address, index) => ({
    tab_id: `desk-${address}`,
    workspace_id: index === 2 ? "target" : "source",
    number: index + 1,
    label: address,
    focused: index === 0,
    pane_count: 1,
    agent_status: "working",
  }));
  const snapshot: NonNullable<WorldRuntimeConnection["snapshot"]> = {
    workspaces: ["source", "target"].map((id, index) => ({
      workspace_id: id,
      number: index + 1,
      label: id,
      focused: index === 0,
      pane_count: index === 0 ? 2 : 1,
      tab_count: index === 0 ? 2 : 1,
      active_tab_id: tabs[index === 0 ? 0 : 2]!.tab_id,
      agent_status: "working",
    })),
    tabs,
    panes: tabs.map((tab, index) => ({
      ...tab,
      pane_id: addresses[index]!,
      terminal_id: addresses[index]!,
      agent: "claude",
      runtime: "herdr-core",
      focused: true,
      revision: 1,
    })),
    agents: [],
  };
  const world = buildWorldObject(
    [
      {
        connectionId: "box",
        label: "Core",
        source: "saved-profile",
        runtime: "herdr-core",
        isDefault: true,
        state: "ready",
        generation: 3,
        snapshotGeneration: 3,
        stale: false,
        actionable: true,
        snapshot,
      },
    ],
    "box",
  );
  const office = projectWorldOffice(world, 1, null, TOWN_PRESENTATION_BOUNDS);
  const model = townModelFromProjection(office);
  const agent = (index: number) =>
    office.roster.find(
      (entry) => entry.agent.currentPaneRef.nativeId === addresses[index],
    )!.agent;
  const desk = (index: number) => model.desks.get(agent(index).deskKey!)!;
  const toasts: [string, string][] = [];
  const confirmations: unknown[] = [];
  const requests: string[] = [];
  const deskPins: Record<string, DeskPins[string]> = {};
  bridge.call = async (method) => {
    requests.push(method);
    throw new Error("Unsupported core moves must send no RPC");
  };
  bridge.connection = ((id: string) => {
    requests.push(id);
    throw new Error("A core move must never use the TUI connection client");
  }) as typeof bridge.connection;
  const actions = townMoveActions({
    moveFlow: null,
    setMoveFlow() {},
    movingKey: null,
    setMovingKey() {},
    moveConfirm: null,
    setMoveConfirm: (confirm) => confirmations.push(confirm),
    world,
    office,
    deskPins,
    relations: [],
    terminalColors: {},
    agentByKey: new Map(office.roster.map((entry) => [entry.agent.key, entry])),
    roomForKey: (key) => model.rooms.get(key ?? "") ?? null,
    toast: (kind, text) => toasts.push([kind, text]),
    trace: NO_TRACE,
  });
  return {
    office,
    model,
    agent,
    desk,
    deskPins,
    actions,
    toasts,
    confirmations,
    requests,
  };
}

test("a live core agent can be picked up and its desk drop reports a visible refusal", async () => {
  const s = await setup();
  const agent = s.agent(0);
  expect(agent.canOpenInSpaces).toBe(false);
  expect(agent.coreChat).toBe(true);
  const drag = townDragFor({ kind: "agent", key: agent.key }, s.model, "desk");
  expect(drag).toMatchObject({ kind: "agent", key: agent.key });
  const target = townDropTarget(
    drag!,
    { kind: "desk", key: s.desk(1).key },
    s.model,
  );
  expect(target.key).toBe(s.desk(1).key);
  expect(await s.actions.runAgentMove(agent.key, target.key!)).toBe("returned");
  expect(s.toasts[s.toasts.length - 1]).toEqual([
    "error",
    expect.stringContaining(
      "not moved: Moving agents between desks or rooms is not supported for herdr-core yet.",
    ),
  ]);
  expect(s.requests).toEqual([]);
});

test("a core agent dropped into another room refuses before asking to close its source room", async () => {
  const s = await setup();
  expect(await s.actions.runAgentMove(s.agent(2).key, s.desk(0).key)).toBe(
    "returned",
  );
  expect(s.confirmations).toEqual([]);
  expect(s.toasts[s.toasts.length - 1]).toEqual([
    "error",
    expect.stringContaining("not supported for herdr-core"),
  ]);
  expect(s.requests).toEqual([]);
});

test("a core desk lifts and visibly refuses both a room move and native desk reordering", async () => {
  const s = await setup();
  const desk = s.desk(2);
  const drag = townDragFor({ kind: "desk", key: desk.key }, s.model, "room");
  expect(drag).toMatchObject({ kind: "desk", key: desk.key });
  const room = s.desk(0).roomKey;
  expect(
    townDropTarget(drag!, { kind: "room", key: room }, s.model),
  ).toMatchObject({ key: room, action: "move" });
  expect(await s.actions.runDeskMove(desk.key, room)).toBe("returned");
  expect(s.confirmations).toEqual([]);
  expect(s.toasts[s.toasts.length - 1]).toEqual([
    "error",
    expect.stringContaining("not supported for herdr-core"),
  ]);
  expect(await s.actions.runDeskReorder(s.desk(0).key, s.desk(1).key)).toBe(
    "returned",
  );
  expect(s.toasts[s.toasts.length - 1]).toEqual([
    "error",
    expect.stringContaining("not supported for herdr-core"),
  ]);
  expect(s.requests).toEqual([]);
});

test("stale core agents and desks cannot be picked up", async () => {
  const s = await setup();
  const agent = s.agent(0);
  const desk = s.desk(0);
  agent.stale = true;
  desk.stale = true;
  expect(
    townDragFor({ kind: "agent", key: agent.key }, s.model, "desk"),
  ).toBeNull();
  expect(
    townDragFor({ kind: "desk", key: desk.key }, s.model, "desk"),
  ).toBeNull();
});

test("grouping a core desk across rooms refuses before changing team membership", async () => {
  const s = await setup();
  expect(await s.actions.teams.runGroupDesk(s.desk(2).key, s.desk(0).key)).toBe(
    "returned",
  );
  expect(s.confirmations).toEqual([]);
  expect(s.toasts[s.toasts.length - 1]).toEqual([
    "error",
    expect.stringContaining("not supported for herdr-core"),
  ]);
  expect(s.requests).toEqual([]);
});

test("core pinned desks still reorder their saved seats without native moves", async () => {
  const s = await setup();
  const keys = [0, 1].map((index) =>
    terminalColorKey(townDeskColorTarget(s.office, s.desk(index))!),
  );
  for (const key of keys) s.deskPins[key] = { cell: null };
  const store = sharedBoardStore();
  const patch = store.patch;
  const writes: BoardOp[][] = [];
  store.patch = async (ops) => {
    writes.push(ops);
    return null;
  };
  try {
    expect(await s.actions.runDeskReorder(s.desk(0).key, s.desk(1).key)).toBe(
      "moved",
    );
    expect(writes).toEqual([
      [
        { op: "desk.rank", key: keys[1], rank: 0 },
        { op: "desk.rank", key: keys[0], rank: 1 },
      ],
    ]);
    expect(s.requests).toEqual([]);
  } finally {
    store.patch = patch;
  }
});
