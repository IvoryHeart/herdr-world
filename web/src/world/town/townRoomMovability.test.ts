import { afterEach, expect, test } from "bun:test";
import { deriveHostGrouping } from "../../../../shared/hostGrouping";
import { bridge } from "../../api";
import { sharedBoardStore, type BoardOp } from "../board/boardDocument";
import { NO_TRACE } from "../devtools/flag";
import { projectWorldOffice } from "../herdrOfficeProjection";
import { officeRoomActionCapabilities } from "../officeRoomActions";
import type { WorldRuntimeConnection } from "../runtimeStore";
import { buildWorldObject } from "../worldObject";
import { createTownBuildings, townBuildingOf } from "./townBuildings";
import { townRoomDrag, townRoomDropTarget } from "./townDrag";
import { layoutTown, TOWN_TILE } from "./townLayout";
import {
  townModelFromProjection,
  townPlaceConnectionOf,
  townRoomColorKey,
} from "./townModel";
import { townMoveActions } from "./townMoveActions";
import { townRoomMoves } from "./townRoomPins";
import {
  townBuildingSpots,
  townReadingOrder,
  type TownRoomPlacement,
} from "./townRoomPlace";
import { requestBuildingRoomOrder, type TownMoveResult } from "./townMoves";
import type { TownRoomActions } from "./townRoomActions";
import {
  townRoomPlacement,
  townRoomRestore,
  townRoomTidy,
} from "./townRoomPlace";
import { townRoomMoveReason } from "./townRoomMovability";
import type { TownToastAction } from "./TownToasts";

const originalConnection = bridge.connection;
const board = sharedBoardStore();
const originalPatch = board.patch;
afterEach(() => {
  bridge.connection = originalConnection;
  board.patch = originalPatch;
});

function setup(mode: "machine" | "runtime") {
  const connections: WorldRuntimeConnection[] = [
    ["core", ["hc:space:demo"], "herdr-core"],
    ["tui", ["w1", "w2"], undefined],
  ].map(([id, ids, runtime]) => ({
    connectionId: id as string,
    label: id as string,
    source: "saved-profile",
    runtime: runtime as "herdr-core" | undefined,
    isDefault: id === "tui",
    state: "ready",
    generation: id === "core" ? 7 : 3,
    snapshotGeneration: id === "core" ? 7 : 3,
    stale: false,
    actionable: true,
    snapshot: {
      workspaces: (ids as string[]).map((workspace_id, index) => ({
        workspace_id,
        number: index + 1,
        label: workspace_id,
        focused: false,
        pane_count: 0,
        tab_count: 0,
        active_tab_id: "",
        agent_status: "idle",
      })),
      tabs: [],
      panes: [],
      agents: [],
    },
  }));
  const world = buildWorldObject(connections, "tui");
  const office = createTownBuildings()(
    projectWorldOffice(world, 0),
    deriveHostGrouping(
      connections.map((connection) => ({
        id: connection.connectionId,
        label: connection.connectionId,
        runtime: connection.runtime ?? "herdr",
        machine: "local",
        endpoint: connection.connectionId,
        writable: true,
      })),
      mode,
      () => false,
    ),
  );
  const model = townModelFromProjection(office);
  const rooms = [...model.rooms.values()];
  const core = rooms.find((room) => room.workspaceRef.connectionId === "core")!;
  const tui = rooms.filter((room) => room.workspaceRef.connectionId === "tui");
  // App space first in reading order, with TUI order reversed below it.
  const spots = new Map([
    [core.key, { x: 4, y: 25 }],
    [tui[1]!.key, { x: 4, y: 65 }],
    [tui[0]!.key, { x: 4, y: 105 }],
  ]);
  let layout = layoutTown(
    model.input,
    "wide",
    new Map(),
    undefined,
    spots,
  ).layout;
  const writes: BoardOp[][] = [];
  board.patch = async (ops) => {
    writes.push(ops);
    for (const op of ops) {
      if (op.op !== "room.place") continue;
      for (const room of rooms) {
        if (townPlaceConnectionOf(room) !== op.connection_id) continue;
        const spot = op.spots[townRoomColorKey(room)];
        if (spot) spots.set(room.key, spot);
      }
    }
    return null;
  };
  const nativeOrder = ["w2", "w1"];
  const requests: { id: string; generation: number; method: string }[] = [];
  bridge.connection = ((id: string, generation: number) => ({
    call: async (
      method: string,
      params: { workspace_id: string; insert_index: number },
    ) => {
      requests.push({ id, generation, method });
      if (id !== "tui") throw new Error("Core must only save World spots");
      if (method === "workspace.list")
        return {
          workspaces: nativeOrder.map((workspace_id, number) => ({
            workspace_id,
            number,
          })),
        };
      if (method === "workspace.move") {
        nativeOrder.splice(nativeOrder.indexOf(params.workspace_id), 1);
        nativeOrder.splice(params.insert_index, 0, params.workspace_id);
      }
      return {};
    },
  })) as typeof bridge.connection;
  const toasts: { kind: string; text: string; action?: TownToastAction }[] = [];
  const base = townMoveActions({
    moveFlow: null,
    setMoveFlow() {},
    movingKey: null,
    setMovingKey() {},
    moveConfirm: null,
    setMoveConfirm() {},
    world,
    office,
    deskPins: {},
    relations: [],
    terminalColors: {},
    agentByKey: new Map(),
    roomForKey: (key) => model.rooms.get(key ?? "") ?? null,
    toast: (kind, text, action) => toasts.push({ kind, text, action }),
    trace: NO_TRACE,
  }).roomMoves;
  const latest = {
    current: { roomActions: base as unknown as TownRoomActions, layout },
  };
  const place = base.onPlaceRooms;
  base.onPlaceRooms = async (
    key: string,
    placement: TownRoomPlacement,
    label?: string,
  ) => {
    const result = await place(key, placement, label);
    if (result === "moved") {
      layout = layoutTown(
        model.input,
        "wide",
        new Map(),
        undefined,
        spots,
      ).layout;
      latest.current.layout = layout;
    }
    return result;
  };
  return {
    world,
    model,
    core,
    tui,
    base,
    latest,
    writes,
    requests,
    toasts,
    order: () => nativeOrder,
    layout: () => layout,
    actions: () =>
      townRoomMoves(base as unknown as TownRoomActions, model, layout, latest),
  };
}

async function tidy(s: ReturnType<typeof setup>, key: string) {
  const completed = Promise.withResolvers<
    (() => Promise<TownMoveResult>) | null
  >();
  const tidied = s.base.onRoomsTidied;
  s.base.onRoomsTidied = (label, undo) => {
    tidied(label, undo);
    completed.resolve(undo);
  };
  s.actions().onTidyRooms!(key);
  const undo = await completed.promise;
  s.base.onRoomsTidied = tidied;
  return undo;
}

for (const mode of ["machine", "runtime"] as const)
  test(`core app space first: Tidy and Undo in ${mode} buildings`, async () => {
    const s = setup(mode);
    expect(officeRoomActionCapabilities(s.world, s.core).rename).toBe(false);
    expect(s.base.canMoveRoom(s.core.key)).toBe(true);
    if (mode === "machine")
      expect(townRoomDrag(s.core.key, s.model)).not.toBeNull();
    const buildings = s.layout().buildings.map((building) => building.hostKey);
    const before = new Map(
      buildings.map((key) => [key, townBuildingSpots(s.layout(), key)]),
    );
    expect(townReadingOrder(before.get(townBuildingOf(s.core))!)[0]).toBe(
      s.core.key,
    );
    const undos: { key: string; run: () => Promise<TownMoveResult> }[] = [];
    for (const key of buildings) {
      expect(s.actions().canTidyRooms!(key)).toBe(true);
      const run = await tidy(s, key);
      expect(run).not.toBeNull();
      undos.push({ key, run: run! });
      expect(townBuildingSpots(s.layout(), key)).not.toEqual(before.get(key)!);
    }
    expect(s.order()).toEqual(["w1", "w2"]);
    expect(
      s.requests.every(
        (request) => request.id === "tui" && request.generation === 3,
      ),
    ).toBe(true);
    expect(
      s.requests.some((request) => request.method === "workspace.move"),
    ).toBe(true);
    expect(
      s.toasts.every(
        (toast) => toast.kind === "ok" && !toast.text.includes("Stayed"),
      ),
    ).toBe(true);
    const undo = s.toasts.flatMap((toast) =>
      toast.action ? [toast.action] : [],
    );
    expect(undo).toHaveLength(buildings.length);
    // Await the actual Tidy Undo callbacks, using the layout shown by then.
    for (const undo of undos.reverse()) {
      expect(await undo.run()).toBe("moved");
      expect(townBuildingSpots(s.layout(), undo.key)).toEqual(
        before.get(undo.key)!,
      );
    }
    expect(s.order()).toEqual(["w2", "w1"]);
    expect(s.toasts.filter((toast) => toast.kind === "error")).toEqual([]);
    expect(s.writes.flat().every((op) => op.op === "room.place")).toBe(true);
  });

test("Tidy skips unavailable core and TUI rooms individually; Undo uses current authority", async () => {
  for (const fixed of ["core", "tui", "unavailable"] as const) {
    const s = setup("machine");
    const host = townBuildingOf(s.core);
    const skipped = fixed === "core" ? s.core : s.tui[0]!;
    if (fixed === "unavailable")
      s.world.nodeById.get(skipped.workspaceRef.worldId)!.actionable = false;
    else skipped.stale = true;
    const before = townBuildingSpots(s.layout(), host);
    const undo = await tidy(s, host);
    expect(undo).not.toBeNull();
    expect(townBuildingSpots(s.layout(), host).get(skipped.key)).toEqual(
      before.get(skipped.key)!,
    );
    const reason =
      fixed === "unavailable"
        ? "this connection cannot reorder workspaces now"
        : "the room is stale";
    expect(
      s.toasts.find((toast) => toast.text.startsWith("Stayed"))?.text,
    ).toContain(`“${skipped.displayLabel}” (${reason})`);
    expect(s.toasts.filter((toast) => toast.kind === "error")).toEqual([]);
    const another = fixed === "core" ? s.tui[1]! : s.core;
    another.stale = true;
    const tidied = townBuildingSpots(s.layout(), host);
    s.toasts.length = 0;
    await undo!();
    const restored = townBuildingSpots(s.layout(), host);
    for (const room of [skipped, another]) {
      expect(restored.get(room.key)).toEqual(tidied.get(room.key)!);
      expect(
        s.toasts.find((toast) => toast.text.startsWith("Stayed"))?.text,
      ).toContain(room.displayLabel);
    }
    expect(s.requests.every((request) => request.id === "tui")).toBe(true);
  }
});

test("a fixed first room does not veto saving the other rooms", async () => {
  const s = setup("machine");
  s.core.stale = true;
  const placement = townRoomTidy(
    s.layout(),
    townBuildingOf(s.core),
    s.base.canMoveRoom,
  )!;
  expect(await s.base.onPlaceRooms(s.core.key, placement)).toBe("moved");
  expect(placement.spots.get(s.core.key)).toEqual(
    placement.before.get(s.core.key)!,
  );
  expect(s.toasts.filter((toast) => toast.kind === "error")).toEqual([]);
});

test("Spaces ordering filters each unavailable room, before or after a live room", async () => {
  const s = setup("machine");
  for (const stale of [false, true])
    for (const first of [false, true]) {
      const absent = {
        ...s.tui[1]!,
        stale,
        workspaceRef: { ...s.tui[1]!.workspaceRef, nativeId: "gone" },
      };
      const rooms = first ? [absent, s.tui[0]!] : [s.tui[0]!, absent];
      s.requests.length = 0;
      expect(
        await requestBuildingRoomOrder(
          rooms,
          (room) => stale || room !== absent,
        ),
      ).toEqual({ status: "moved" });
      expect(s.requests.map((request) => request.method)).toEqual([
        "workspace.list",
      ]);
    }
});

test("Undo with no rooms still movable explains the skips without saving", async () => {
  const s = setup("machine");
  const undo = await tidy(s, townBuildingOf(s.core));
  for (const room of s.model.rooms.values()) room.stale = true;
  s.toasts.length = 0;
  const writes = s.writes.length;
  expect(await undo!()).toBe("returned");
  expect(s.writes).toHaveLength(writes);
  expect(s.toasts).toHaveLength(1);
  for (const room of s.model.rooms.values())
    expect(s.toasts[0]!.text).toContain(room.displayLabel);
});

test("save checks every changed room, including one after a movable first room", async () => {
  const s = setup("machine");
  const placement = townRoomTidy(s.layout(), townBuildingOf(s.core))!;
  const later = placement.order[placement.order.length - 1]!;
  s.model.rooms.get(later)!.stale = true;
  expect(s.base.canMoveRoom(placement.order[0]!)).toBe(true);
  expect(await s.base.onPlaceRooms(placement.order[0]!, placement)).toBe(
    "returned",
  );
  expect(s.writes).toEqual([]);
  expect(s.requests).toEqual([]);
  expect(s.toasts[0]!.text).toContain(s.model.rooms.get(later)!.displayLabel);
});

test("movement authority ignores rename but requires qualified live room admission", () => {
  const s = setup("machine");
  for (const room of [s.core, ...s.tui]) {
    const space = s.world.nodeById.get(room.workspaceRef.worldId)!;
    for (const roomStale of [false, true])
      for (const spaceStale of [false, true])
        for (const actionable of [false, true]) {
          room.stale = roomStale;
          space.stale = spaceStale;
          space.actionable = actionable;
          space.capabilities.roomMutation = false;
          expect(s.base.canMoveRoom(room.key)).toBe(
            !roomStale && !spaceStale && (room === s.core || actionable),
          );
        }
    room.stale = false;
    space.stale = false;
    room.workspaceRef = {
      ...room.workspaceRef,
      generation: room.workspaceRef.generation + 1,
    };
    expect(townRoomMoveReason(s.world, room)).toContain("connection changed");
  }
  expect(s.actions().canTidyRooms!(townBuildingOf(s.core))).toBe(false);
});

test("drag and neighbour moves reserve a fixed neighbour's spot", () => {
  const s = setup("machine");
  const fixed = s.tui[1]!;
  fixed.stale = true;
  const host = townBuildingOf(s.core);
  const before = townBuildingSpots(s.layout(), host);
  const building = s.layout().buildings.find((each) => each.hostKey === host)!;
  const drag = townRoomDrag(s.core.key, s.model, s.base.canMoveRoom)!;
  const spot = before.get(fixed.key)!;
  const x = (building.x + spot.x) * TOWN_TILE;
  const y = (building.y + spot.y) * TOWN_TILE;
  const drop = townRoomDropTarget(
    drag,
    s.layout(),
    s.model,
    x,
    y,
    x,
    y,
    s.base.canMoveRoom,
  );
  expect(drop.placement!.spots.get(fixed.key)).toEqual(spot);
  expect(drop.placement!.spots.get(s.core.key)).not.toEqual(spot);
  expect(s.actions().roomMoveNeighbor!(s.core.key, 1)).toBeNull();
  s.actions().onMoveRoom!(s.core.key, 1);
  expect(s.writes).toEqual([]);
  expect(townRoomDrag(fixed.key, s.model, s.base.canMoveRoom)).toBeNull();
});

test("all room authority subsets preserve fixed spots through Tidy, collisions and Undo", () => {
  const s = setup("machine");
  const host = townBuildingOf(s.core);
  const rooms = [...s.model.rooms.keys()];
  const before = townBuildingSpots(s.layout(), host);
  const clear = (placement: TownRoomPlacement) => {
    for (const a of rooms)
      for (const b of rooms) {
        if (a === b) continue;
        const sa = placement.spots.get(a)!;
        const sb = placement.spots.get(b)!;
        const boxA = placement.rooms.get(a)!;
        const boxB = placement.rooms.get(b)!;
        expect(
          sa.x + boxA.w + 2 <= sb.x ||
            sb.x + boxB.w + 2 <= sa.x ||
            sa.y + boxA.h + 2 <= sb.y ||
            sb.y + boxB.h + 2 <= sa.y,
        ).toBe(true);
      }
  };
  for (let mask = 0; mask < 1 << rooms.length; mask++) {
    const canMove = (key: string) => Boolean(mask & (1 << rooms.indexOf(key)));
    const placement = townRoomTidy(s.layout(), host, canMove)!;
    const collisions = townRoomPlacement(
      s.layout(),
      host,
      new Map(rooms.map((key) => [key, before.get(rooms[0]!)!])),
      canMove,
    )!;
    for (const candidate of [placement, collisions]) {
      clear(candidate);
      for (const key of rooms)
        if (!canMove(key))
          expect(candidate.spots.get(key)).toEqual(before.get(key)!);
    }
    const layout = layoutTown(
      s.model.input,
      "wide",
      new Map(),
      undefined,
      placement.spots,
    ).layout;
    for (let after = 0; after < 1 << rooms.length; after++) {
      const canUndo = (key: string) =>
        Boolean(after & (1 << rooms.indexOf(key)));
      const undo = townRoomRestore(layout, host, before, canUndo)!;
      clear(undo);
      for (const key of rooms)
        if (!canUndo(key))
          expect(undo.spots.get(key)).toEqual(placement.spots.get(key)!);
    }
  }
});
