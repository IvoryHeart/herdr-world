import { expect, test } from "bun:test";
import { TownCamera, type TownLevel } from "../townCamera";
import { TOWN_MAGNET_MS } from "../townDrag";
import { TOWN_HOLD_MS } from "../townGesture";
import {
  layoutTown,
  TOWN_TILE as T,
  townSeat,
  townShapeFor,
  type TownCell,
} from "../townLayout";
import { townModelFromProjection } from "../townModel";
import type { TownMoveResult } from "../townMoves";
import { townRoomSpotAt, type TownRoomPlacement } from "../townRoomPlace";
import { NO_TOWN_TEAMS, type TownTeams } from "../townTeams";
import type { TownFrames } from "./ports";
import {
  TownInteraction,
  type TownMoveCommand,
  type TownStage,
} from "./townInteraction";
import { manualClock, office, working } from "./townScene.fixture";
import { TownSceneCamera, townViewport } from "./townSceneCamera";

const WIDE = { width: 1440, height: 900 };

type Point = { x: number; y: number };

const last = <T>(list: readonly T[]) => list[list.length - 1];

/** Frames that run only when the test steps them. */
function testFrames() {
  let queue: (() => void)[] = [];
  const frames: TownFrames = {
    next(run) {
      queue.push(run);
      return () => {
        queue = queue.filter((entry) => entry !== run);
      };
    },
  };
  return {
    frames,
    pending: () => queue.length,
    step() {
      const due = queue;
      queue = [];
      for (const run of due) run();
    },
  };
}

function setup(
  options: {
    level?: TownLevel;
    zoom?: number;
    teams?: TownTeams;
    /** Tables have cards (TownCanvas: drawn with their nameplates). */
    cards?: boolean;
  } = {},
) {
  const projection = office({
    alpha: working(3),
    beta: working(2),
    gamma: working(2),
  });
  const model = townModelFromProjection(projection);
  const layout = layoutTown(
    model.input,
    townShapeFor(WIDE.width, WIDE.height),
    new Map(),
    new Map(),
  ).layout;
  const reasons: string[] = [];
  const view = new TownSceneCamera(new Map(), (reason) => reasons.push(reason));
  const viewport = townViewport(WIDE.width, WIDE.height, {
    left: 0,
    right: 0,
  });
  const camera = new TownCamera();
  camera.viewport = viewport;
  view.attach(camera, layout, viewport);
  // Look at the first building, whatever else stands on its street.
  const first = layout.buildings[0]!;
  camera.jumpTo((first.x + first.w / 2) * T, camera.y, options.zoom ?? 1.2);
  const time = manualClock();
  const frames = testFrames();
  const log: unknown[][] = [];
  const moves: TownMoveCommand[] = [];
  let roofs = 0;
  let level: TownLevel = options.level ?? "room";
  let ready = true;
  let hovered: string | null = null;
  let carded: string | null = null;
  let result: Promise<TownMoveResult> = Promise.resolve("moved");
  /** Agents standing (walking, queued, lounging) where the renderer has them. */
  const standing = new Map<string, Point>();
  const stage: TownStage = {
    camera,
    get level() {
      return level;
    },
    invalidate: (reason) => reasons.push(reason),
    roofAlpha: () => roofs,
    actorPosition: (key) => {
      const at = standing.get(key);
      return at ? { ...at, seated: false } : null;
    },
    beginDrag: (...args) => log.push(["begin", ...args]),
    moveDrag: (...args) => log.push(["aim", ...args]),
    endDrag: (mode) => log.push(["end", mode]),
    finishMove: (outcome) => log.push(["finish", outcome]),
  };
  const ghost: unknown[][] = [];
  /** Where the bin lies on the canvas, when a test puts one there. */
  let binAt: ((at: Point) => boolean) | null = null;
  const binned: unknown[] = [];
  const interaction = new TownInteraction({
    clock: time.clock,
    frames: frames.frames,
    view,
    stage: () => (ready ? stage : null),
    world: () => ({ model, layout, teams: options.teams ?? NO_TOWN_TEAMS }),
    hovered: () => hovered,
    setHovered: (key) => {
      hovered = key;
      log.push(["hovered", key]);
    },
    hover: (hover) => log.push(["hover", hover?.key ?? null]),
    cursor: (pointer) => log.push(["cursor", pointer]),
    select: (key) => log.push(["select", key]),
    tapCard: options.cards
      ? (deskKey) => {
          log.push(["card", deskKey]);
          const opens = deskKey !== null && deskKey !== carded;
          carded = opens ? deskKey : null;
          return opens;
        }
      : undefined,
    activateAgent: (key) => log.push(["activate", key]),
    activateRoom: (key) => log.push(["room", key]),
    openReception: (key) => log.push(["reception", key]),
    openCenter: () => log.push(["center"]),
    move: (command) => {
      moves.push(command);
      return result;
    },
    ghost: {
      lift: (label) => ghost.push(["lift", label]),
      aim: (label, valid, action) => ghost.push(["aim", label, valid, action]),
      remove: () => ghost.push(["remove"]),
    },
    held: () => log.push(["held"]),
    binAt: (at) => Boolean(at && binAt?.(at)),
    bin: (drag) => binned.push(drag),
  });
  /** Draw a frame, as the renderer does, so presses hit what is drawn. */
  const draw = () => view.drew(camera, level, layout);
  draw();
  const screen = (world: Point) => camera.toScreen(world.x, world.y);
  const deskCentre = (cell: TownCell) =>
    screen({ x: (cell.x + 1) * T + 32, y: cell.y * T + 30 });
  const rooms = layout.buildings[0]!.rooms;
  const deskCell = (room: number, index = 0) =>
    rooms[room]!.cells.filter((cell) => cell.deskKey)[index]!;
  let id = 1;
  const press = (
    at: Point,
    pointerType = "mouse",
    primary = true,
    card?: string,
  ) => {
    const pointer = id++;
    interaction.down({ id: pointer, at, primary, pointerType, card });
    return pointer;
  };
  return {
    interaction,
    camera,
    view,
    layout,
    model,
    time,
    frames,
    log,
    moves,
    ghost,
    binned,
    setBin: (over: (at: Point) => boolean) => (binAt = over),
    reasons,
    draw,
    press,
    deskCell,
    deskCentre,
    rooms,
    screen,
    stand: (agentKey: string, world: Point) => standing.set(agentKey, world),
    setLevel: (next: TownLevel) => (level = next),
    setRoofs: (alpha: number) => (roofs = alpha),
    setReady: (next: boolean) => (ready = next),
    setResult: (next: Promise<TownMoveResult>) => (result = next),
    moveTo: (pointer: number, at: Point, pointerType = "mouse") =>
      interaction.move({ id: pointer, at, pointerType, client: at }),
    lift: (pointer: number, at: Point) =>
      interaction.up({ id: pointer, at, cancel: false }),
  };
}

const offset = (at: Point, dx: number, dy = 0) => ({
  x: at.x + dx,
  y: at.y + dy,
});

test("a tap selects what is under it as last drawn, even after an undrawn pan", () => {
  const t = setup();
  const cell = t.deskCell(0);
  const at = t.deskCentre(cell);
  // An arrow key pans the live camera; the screen still shows the last frame.
  t.view.key("ArrowLeft");
  t.camera.update(1 / 60);
  expect(t.screen({ x: (cell.x + 1) * T + 32, y: 0 }).x).not.toBeCloseTo(at.x);
  const pointer = t.press(at);
  t.lift(pointer, at);
  expect(t.log).toContainEqual(["select", cell.deskKey]);
});

test("a tap on a room's floor opens the room and zooms to it above desk level", () => {
  const t = setup();
  const room = t.rooms[1]!;
  const floor = t.screen({ x: room.x * T + 4, y: (room.y + room.h) * T - 4 });
  t.lift(t.press(floor), floor);
  expect(t.log).toContainEqual(["room", room.key]);
  expect(t.reasons).toContain("room");
  t.reasons.length = 0;
  t.setLevel("desk");
  t.draw();
  t.time.advance(1000);
  t.lift(t.press(floor), floor);
  expect(t.reasons).not.toContain("room");
});

test("at desk level a tap on the lobby brings its reception board back into view", () => {
  const t = setup({ level: "desk", zoom: 2.5 });
  const building = t.layout.buildings[0]!;
  // The camera on the lobby: the board's foot above it is too near the top.
  t.camera.jumpTo((building.entryX + 0.5) * T, (building.lobbyY + 4) * T, 2.5);
  t.draw();
  const lobby = t.screen({
    x: (building.entryX + 0.5) * T,
    y: (building.lobbyY + 5) * T,
  });
  t.lift(t.press(lobby), lobby);
  expect(t.log).toContainEqual(["reception", building.hostKey]);
  expect(t.reasons).toContain("reception");
  expect(t.log.some(([kind]) => kind === "select" || kind === "room")).toBe(
    false,
  );
  // A level flight: the zoom never dips out of desk level on the way.
  for (let i = 0; i < 120; i += 1) {
    t.camera.update(1 / 60);
    expect(t.camera.z).toBeCloseTo(2.5);
  }
  // Settled, the board's foot has room above it and the lobby is below.
  const foot = t.camera.toScreen(
    (building.entryX + 0.5) * T,
    building.y * T - 18,
  );
  expect(foot.y).toBeGreaterThanOrEqual(260);
  expect(t.camera.toScreen(0, (building.lobbyY + 7) * T).y).toBeLessThanOrEqual(
    WIDE.height,
  );
  // Any other tap puts it away again.
  t.draw();
  t.time.advance(1000);
  const room = t.rooms[1]!;
  const floor = t.screen({ x: room.x * T + 4, y: (room.y + room.h) * T - 4 });
  t.lift(t.press(floor), floor);
  expect(t.log[t.log.length - 2]).toEqual(["reception", null]);
});

test("above desk level the lobby is no reception target: its board shows", () => {
  const t = setup();
  const building = t.layout.buildings[0]!;
  const lobby = t.screen({
    x: (building.entryX + 0.5) * T,
    y: (building.lobbyY + 5) * T,
  });
  t.lift(t.press(lobby), lobby);
  expect(t.log).toContainEqual(["reception", null]);
  expect(t.reasons).not.toContain("reception");
});

test("a tap on the town center opens its menu; a touch hold there pans", () => {
  const t = setup();
  const center = t.layout.center;
  // Look at the center's doors, then tap them.
  t.camera.jumpTo((center.x + center.w / 2) * T, (center.y + 10) * T, 1);
  t.draw();
  const doors = t.screen({
    x: (center.x + center.w / 2) * T,
    y: (center.y + center.h - 3) * T,
  });
  t.lift(t.press(doors), doors);
  expect(t.log).toContainEqual(["center"]);
  expect(t.log.some(([kind]) => kind === "select")).toBe(false);
  // Hovering it shows a pointer, not an agent's card.
  t.log.length = 0;
  t.moveTo(-1, doors);
  expect(t.log).toContainEqual(["cursor", "pointer"]);
  expect(t.log).toContainEqual(["hover", null]);
  // Nothing lifts from it: a touch held there and moved pans the town.
  t.log.length = 0;
  t.time.advance(1000);
  const pointer = t.press(doors, "touch");
  t.time.advance(TOWN_HOLD_MS * 2);
  t.moveTo(pointer, offset(doors, 40), "touch");
  t.lift(pointer, offset(doors, 40));
  expect(t.log.some(([kind]) => kind === "begin" || kind === "center")).toBe(
    false,
  );
  expect(t.reasons).toContain("pan");
});

test("a tap on a roofed building zooms to it", () => {
  const t = setup();
  t.setRoofs(1);
  const at = t.deskCentre(t.deskCell(0));
  t.lift(t.press(at), at);
  expect(t.reasons).toContain("building");
  expect(t.log.some(([kind]) => kind === "select")).toBe(false);
});

test("a touch held still on a desk lifts it after the hold time", () => {
  const t = setup();
  const cell = t.deskCell(0);
  const at = t.deskCentre(cell);
  const pointer = t.press(at, "touch");
  t.time.advance(TOWN_HOLD_MS - 1);
  expect(t.log.some(([kind]) => kind === "begin")).toBe(false);
  t.time.advance(1);
  expect(t.log).toContainEqual(["held"]);
  expect(t.log.find(([kind]) => kind === "begin")?.slice(0, 3)).toEqual([
    "begin",
    "desk",
    cell.deskKey,
  ]);
  expect(t.ghost[0]?.[0]).toBe("lift");
  t.interaction.up({ id: pointer, at, cancel: true });
  expect(t.log).toContainEqual(["end", "cancel"]);
});

test("a touch that moves before the hold pans instead of lifting", () => {
  const t = setup();
  const at = t.deskCentre(t.deskCell(0));
  const pointer = t.press(at, "touch");
  t.moveTo(pointer, offset(at, 40), "touch");
  t.time.advance(TOWN_HOLD_MS * 2);
  expect(t.log.some(([kind]) => kind === "begin")).toBe(false);
  expect(t.reasons).toContain("pan");
});

test("a desk dragged to another room asks to move there, waits, then lands", async () => {
  const t = setup();
  const cell = t.deskCell(0);
  const at = t.deskCentre(cell);
  const room = t.rooms[1]!;
  const floor = t.screen({ x: room.x * T + 4, y: (room.y + room.h) * T - 4 });
  const pointer = t.press(at);
  t.moveTo(pointer, offset(at, 20));
  expect(t.log.some(([kind]) => kind === "begin")).toBe(true);
  // A mouse lifts without a touch hold, so nothing vibrates.
  expect(t.log).not.toContainEqual(["held"]);
  t.moveTo(pointer, floor);
  t.lift(pointer, floor);
  expect(t.moves).toEqual([
    { kind: "desk", deskKey: cell.deskKey!, roomKey: room.key },
  ]);
  expect(t.log).toContainEqual(["end", "park"]);
  await Promise.resolve();
  await Promise.resolve();
  expect(t.log).toContainEqual(["finish", "moved"]);
  expect(last(t.ghost)).toEqual(["remove"]);
});

test("a move that fails lands as uncertain", async () => {
  const t = setup();
  t.setResult(Promise.reject(new Error("lost")));
  const at = t.deskCentre(t.deskCell(0));
  const room = t.rooms[1]!;
  const floor = t.screen({ x: room.x * T + 4, y: (room.y + room.h) * T - 4 });
  const pointer = t.press(at);
  t.moveTo(pointer, offset(at, 20));
  t.moveTo(pointer, floor);
  t.lift(pointer, floor);
  for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
  expect(t.log).toContainEqual(["finish", "uncertain"]);
});

test("a drop outside every building springs back and asks nothing", () => {
  const t = setup();
  const at = t.deskCentre(t.deskCell(0));
  const pointer = t.press(at);
  t.moveTo(pointer, offset(at, 20));
  const outside = { x: 2, y: 2 };
  t.moveTo(pointer, outside);
  t.lift(pointer, outside);
  expect(t.moves).toEqual([]);
  expect(t.log).toContainEqual(["end", "cancel"]);
});

test("a desk dropped on the bin is put in it and moves nowhere", () => {
  const t = setup();
  t.setBin((at) => at.x < 10 && at.y < 10);
  const cell = t.deskCell(0);
  const at = t.deskCentre(cell);
  const pointer = t.press(at);
  t.moveTo(pointer, offset(at, 20));
  t.moveTo(pointer, { x: 4, y: 4 });
  expect(last(t.ghost)).toEqual(["aim", "Put in the bin", true, "bin"]);
  t.lift(pointer, { x: 4, y: 4 });
  expect(t.moves).toEqual([]);
  expect(t.binned).toEqual([{ kind: "desk", key: cell.deskKey }]);
  expect(t.log).toContainEqual(["end", "cancel"]);
});

test("a desk carried over the bin and away drops as usual", () => {
  const t = setup();
  t.setBin((at) => at.x < 10 && at.y < 10);
  const cell = t.deskCell(0);
  const at = t.deskCentre(cell);
  const room = t.rooms[1]!;
  const floor = t.screen({ x: room.x * T + 4, y: (room.y + room.h) * T - 4 });
  const pointer = t.press(at);
  t.moveTo(pointer, offset(at, 20));
  t.moveTo(pointer, { x: 4, y: 4 });
  t.moveTo(pointer, floor);
  t.lift(pointer, floor);
  expect(t.binned).toEqual([]);
  expect(t.moves).toEqual([
    { kind: "desk", deskKey: cell.deskKey!, roomKey: room.key },
  ]);
});

test("a desk rested on another desk snaps to it after the magnet time and groups", () => {
  const t = setup();
  const cell = t.deskCell(0);
  const other = t.deskCell(1, 0);
  const at = t.deskCentre(cell);
  const onto = t.deskCentre(other);
  const pointer = t.press(at);
  t.moveTo(pointer, offset(at, 20));
  t.moveTo(pointer, onto);
  expect(last(t.ghost)?.[3]).not.toBe("group");
  t.time.advance(TOWN_MAGNET_MS - 1);
  expect(last(t.ghost)?.[3]).not.toBe("group");
  t.time.advance(1);
  expect(last(t.ghost)?.[3]).toBe("group");
  t.lift(pointer, onto);
  expect(t.moves).toEqual([
    { kind: "group", deskKey: cell.deskKey!, targetDeskKey: other.deskKey! },
  ]);
});

test("a carry near the edge pans the town each frame until it drops", () => {
  const t = setup();
  const at = t.deskCentre(t.deskCell(0));
  const pointer = t.press(at);
  t.moveTo(pointer, offset(at, 20));
  const edge = { x: 0, y: 450 };
  t.moveTo(pointer, edge);
  t.reasons.length = 0;
  const x = t.camera.x;
  t.frames.step();
  // At the very edge: 14 screen pixels a frame.
  expect(x - t.camera.x).toBeCloseTo(14 / t.camera.z);
  t.frames.step();
  expect(x - t.camera.x).toBeCloseTo(28 / t.camera.z);
  expect(t.reasons).toEqual(["edge-pan", "edge-pan"]);
  // Halfway into the edge zone (56 px inside the 16 px inset): half speed.
  t.moveTo(pointer, { x: 16 + 28, y: 450 });
  const half = t.camera.x;
  t.frames.step();
  expect(half - t.camera.x).toBeCloseTo(7 / t.camera.z);
  // Away from the edges the frames keep coming but the town holds still.
  t.moveTo(pointer, { x: 720, y: 450 });
  const held = t.camera.x;
  t.frames.step();
  expect(t.camera.x).toBe(held);
  expect(t.frames.pending()).toBe(1);
  t.lift(pointer, { x: 720, y: 450 });
  expect(t.frames.pending()).toBe(0);
});

test("a camera that moves under a still carry aims at what is now drawn", () => {
  const t = setup();
  const at = t.deskCentre(t.deskCell(0, 0));
  const over = t.deskCentre(t.deskCell(0, 2));
  const pointer = t.press(at);
  t.moveTo(pointer, offset(at, 20));
  t.moveTo(pointer, over);
  const label = () => last(t.ghost)?.[1];
  const before = label();
  // Arrow-key pans move the town under the still pointer; once drawn, the
  // carry aims where it now is, as a move to the same point would.
  let aimed: unknown = before;
  for (let step = 0; step < 12 && aimed === before; step += 1) {
    t.view.key("ArrowLeft");
    t.camera.update(1 / 60);
    t.draw();
    t.interaction.reaim();
    aimed = label();
  }
  expect(aimed).not.toBe(before);
  t.moveTo(pointer, over);
  expect(label()).toBe(aimed);
});

test("the wheel zooms about the pointer", () => {
  const t = setup();
  const at = { x: 300, y: 200 };
  const world = t.camera.toWorld(at.x, at.y);
  const z = t.camera.z;
  expect(t.interaction.wheel(at, -100, false)).toBe(true);
  t.camera.update(1);
  expect(t.camera.z).toBeGreaterThan(z);
  const after = t.camera.toScreen(world.x, world.y);
  expect(after.x).toBeCloseTo(at.x, 0);
  expect(after.y).toBeCloseTo(at.y, 0);
  expect(t.reasons).toContain("wheel");
  t.setReady(false);
  expect(t.interaction.wheel(at, -100, false)).toBe(false);
});

test("a double tap opens a desk's agent, or zooms in elsewhere", () => {
  const t = setup();
  const cell = t.deskCell(0);
  const at = t.deskCentre(cell);
  t.lift(t.press(at), at);
  t.time.advance(100);
  t.lift(t.press(at), at);
  expect(t.log).toContainEqual(["activate", cell.deskKey]);
  t.time.advance(1000);
  const outside = { x: 2, y: 2 };
  const z = t.camera.z;
  t.lift(t.press(outside), outside);
  t.time.advance(100);
  t.lift(t.press(outside), outside);
  t.camera.update(1);
  expect(t.camera.z).toBeGreaterThan(z * 1.5);
});

test("a touch tap on a table opens its card first; a second tap opens the table", () => {
  const t = setup({ cards: true });
  const cell = t.deskCell(0);
  const at = t.deskCentre(cell);
  t.lift(t.press(at, "touch"), at);
  expect(t.log).toContainEqual(["card", cell.deskKey]);
  expect(t.log.some(([kind]) => kind === "select")).toBe(false);
  t.time.advance(1000);
  t.lift(t.press(at, "touch"), at);
  expect(t.log).toContainEqual(["select", cell.deskKey]);
  // A touch tap elsewhere closes an open card.
  t.time.advance(1000);
  t.lift(t.press(at, "touch"), at);
  t.log.length = 0;
  t.time.advance(1000);
  const outside = { x: 2, y: 2 };
  t.lift(t.press(outside, "touch"), outside);
  expect(t.log).toContainEqual(["card", null]);
  // A mouse has hover: its click opens the table at once.
  t.log.length = 0;
  t.time.advance(1000);
  t.lift(t.press(at), at);
  expect(t.log).toContainEqual(["select", cell.deskKey]);
  expect(t.log.some(([kind]) => kind === "card")).toBe(false);
});

test("a hovering mouse names what is under it, and leaving clears it", () => {
  const t = setup();
  const cell = t.deskCell(0);
  const at = t.deskCentre(cell);
  t.interaction.move({ id: 99, at, pointerType: "mouse", client: at });
  expect(t.log).toContainEqual(["hovered", cell.deskKey]);
  expect(t.log).toContainEqual(["cursor", "pointer"]);
  expect(t.log).toContainEqual(["hover", cell.deskKey]);
  // The same key again does not set it again.
  t.log.length = 0;
  t.interaction.move({ id: 99, at, pointerType: "mouse", client: at });
  expect(t.log.some(([kind]) => kind === "hovered")).toBe(false);
  t.interaction.leave();
  expect(t.log).toContainEqual(["hovered", null]);
  expect(t.log).toContainEqual(["hover", null]);
  // Touch never hovers.
  t.log.length = 0;
  t.interaction.move({ id: 98, at, pointerType: "touch", client: at });
  expect(t.log).toEqual([]);
});

test("two fingers spreading zoom about their midpoint", () => {
  const t = setup();
  // On open ground, so neither finger waits to lift a desk.
  const a = { x: 600, y: 4 };
  const b = { x: 700, y: 4 };
  const mid = { x: 650, y: 4 };
  const world = t.camera.toWorld(mid.x, mid.y);
  const z = t.camera.z;
  const first = t.press(a, "touch");
  const second = t.press(b, "touch", false);
  t.moveTo(first, { x: 550, y: 4 }, "touch");
  t.moveTo(second, { x: 750, y: 4 }, "touch");
  expect(t.camera.z).toBeCloseTo(z * 2, 1);
  const after = t.camera.toScreen(world.x, world.y);
  expect(after.x).toBeCloseTo(mid.x, 0);
  expect(t.reasons).toContain("pinch");
});

test("nothing happens before a renderer is ready", () => {
  const t = setup();
  t.setReady(false);
  const at = t.deskCentre(t.deskCell(0));
  const pointer = t.press(at);
  t.moveTo(pointer, offset(at, 20));
  t.lift(pointer, at);
  expect(t.log).toEqual([]);
  expect(t.interaction.pressed(pointer)).toBe(false);
});

test("dispose cancels a pending hold and the edge pan, and removes the ghost", () => {
  const t = setup();
  const at = t.deskCentre(t.deskCell(0));
  t.press(at, "touch");
  t.interaction.dispose();
  t.time.advance(TOWN_HOLD_MS * 2);
  expect(t.log.some(([kind]) => kind === "begin")).toBe(false);
  const other = setup();
  const pointer = other.press(at);
  other.moveTo(pointer, offset(at, 20));
  expect(other.frames.pending()).toBe(1);
  other.interaction.dispose();
  expect(other.frames.pending()).toBe(0);
  expect(last(other.ghost)).toEqual(["remove"]);
});

/** Carry from `from` and drop at once at `to`. */
function carry(t: ReturnType<typeof setup>, from: Point, to: Point) {
  const pointer = t.press(from);
  t.moveTo(pointer, offset(from, 20));
  t.moveTo(pointer, to);
  t.lift(pointer, to);
}

/** The agent seated first at room `room`'s desk `index`. */
const agentAt = (t: ReturnType<typeof setup>, room: number, index: number) =>
  t.model.desks.get(t.deskCell(room, index).deskKey!)!.paneDevices[0]!
    .agentKey!;

test("a carry looks through an agent walking over another room's floor", () => {
  const t = setup();
  const cell = t.deskCell(0, 0);
  const room = t.rooms[1]!;
  // An agent from the carried desk's own room walks across room 1's floor.
  const walker = agentAt(t, 0, 1);
  const feet = { x: room.x * T + 24, y: (room.y + room.h) * T - 4 };
  t.stand(walker, feet);
  const over = t.screen({ x: feet.x, y: feet.y - 6 });
  expect(t.interaction.hitAt(over.x, over.y)).toEqual({
    kind: "agent",
    key: walker,
    standing: true,
  });
  const pointer = t.press(t.deskCentre(cell));
  t.moveTo(pointer, offset(t.deskCentre(cell), 20));
  t.moveTo(pointer, over);
  expect(last(t.ghost)?.[3]).toBe("move");
  // Resting there is resting on room 1's floor, not on the walker's desk.
  t.time.advance(TOWN_MAGNET_MS);
  expect(last(t.ghost)?.[3]).toBe("move");
  t.lift(pointer, over);
  expect(t.moves).toEqual([
    { kind: "desk", deskKey: cell.deskKey!, roomKey: room.key },
  ]);
});

test("a carried agent lands on the desk drawn under an agent walking past", () => {
  const t = setup({ level: "desk" });
  const cell = t.deskCell(0, 0);
  const agentKey = agentAt(t, 0, 0);
  const seat = townSeat(cell, 0);
  const from = t.screen({
    x: seat.cx,
    y: seat.top ? cell.y * T + 10 : cell.y * T + 45,
  });
  const other = t.deskCell(1, 0);
  // An agent from room 2 walks past the middle of room 1's first desk.
  const walker = agentAt(t, 2, 0);
  const middle = { x: (other.x + 1) * T + 32, y: other.y * T + 30 };
  t.stand(walker, { x: middle.x, y: middle.y + 2 });
  const over = t.screen(middle);
  expect(t.interaction.hitAt(over.x, over.y)?.kind).toBe("agent");
  carry(t, from, over);
  expect(t.moves).toEqual([
    { kind: "agent", agentKey, deskKey: other.deskKey! },
  ]);
});

test("an agent walking elsewhere is picked up where it walks, not at its empty chair", () => {
  const t = setup({ level: "desk" });
  const cell = t.deskCell(0, 0);
  const walker = agentAt(t, 0, 0);
  const seat = townSeat(cell, 0);
  const chair = t.screen({
    x: seat.cx,
    y: seat.top ? cell.y * T + 10 : cell.y * T + 45,
  });
  expect(t.interaction.hitAt(chair.x, chair.y)).toEqual({
    kind: "agent",
    key: walker,
  });
  const room = t.rooms[1]!;
  const feet = { x: room.x * T + 24, y: (room.y + room.h) * T - 4 };
  t.stand(walker, feet);
  // Its chair is drawn empty: it is the pane, with or without a carry.
  for (const standing of [true, false])
    expect(t.interaction.hitAt(chair.x, chair.y, standing)).toMatchObject({
      kind: "pane",
      deskKey: cell.deskKey,
    });
  const begun = () => t.log.filter(([kind]) => kind === "begin");
  const atChair = t.press(chair);
  t.moveTo(atChair, offset(chair, 20));
  expect(last(begun())?.[1]).not.toBe("agent");
  t.lift(atChair, { x: -10, y: -10 });
  const seen = t.screen({ x: feet.x, y: feet.y - 6 });
  const atWalker = t.press(seen);
  t.moveTo(atWalker, offset(seen, 20));
  expect(last(begun())?.slice(1, 3)).toEqual(["agent", walker]);
});

test("a desk dropped at once on a desk in its room takes that desk's place", () => {
  const t = setup();
  const cell = t.deskCell(0, 0);
  const other = t.deskCell(0, 2);
  carry(t, t.deskCentre(cell), t.deskCentre(other));
  expect(t.moves).toEqual([
    { kind: "reorder", deskKey: cell.deskKey!, ontoDeskKey: other.deskKey! },
  ]);
});

test("a desk dropped on its room's free spot goes last", () => {
  const t = setup({ level: "desk" });
  const room = t.rooms[0]!;
  const free = room.cells.find((cell) => !cell.deskKey)!;
  expect(free).toBeDefined();
  const cell = t.deskCell(0, 0);
  carry(
    t,
    t.deskCentre(cell),
    t.screen({ x: (free.x + 1) * T + 32, y: free.y * T + 30 }),
  );
  expect(t.moves).toEqual([
    { kind: "reorder", deskKey: cell.deskKey!, ontoDeskKey: null },
  ]);
});

test("a grouped desk dropped on its own room's floor leaves its team", () => {
  const first = setup();
  const cell = first.deskCell(0, 0);
  const t = setup({
    teams: { ...NO_TOWN_TEAMS, groupedDesks: new Set([cell.deskKey!]) },
  });
  const room = t.rooms[0]!;
  carry(
    t,
    t.deskCentre(cell),
    t.screen({ x: room.x * T + 4, y: (room.y + room.h) * T - 4 }),
  );
  expect(t.moves).toEqual([{ kind: "ungroup", deskKey: cell.deskKey! }]);
});

test("an agent carried from its seat to another desk asks to move there", () => {
  const t = setup({ level: "desk" });
  const cell = t.deskCell(0, 0);
  const desk = t.model.desks.get(cell.deskKey!)!;
  const agentKey = desk.paneDevices[0]!.agentKey!;
  expect(t.model.agents.has(agentKey)).toBe(true);
  const seat = townSeat(cell, 0);
  const at = t.screen({
    x: seat.cx,
    y: seat.top ? cell.y * T + 10 : cell.y * T + 45,
  });
  const other = t.deskCell(1, 0);
  carry(t, at, t.deskCentre(other));
  expect(t.moves).toEqual([
    { kind: "agent", agentKey, deskKey: other.deskKey! },
  ]);
});

test("a trackpad pinch (ctrl wheel) zooms faster than a wheel step", () => {
  const plain = setup();
  const pinch = setup();
  const at = { x: 300, y: 200 };
  plain.interaction.wheel(at, -10, false);
  pinch.interaction.wheel(at, -10, true);
  plain.camera.update(1);
  pinch.camera.update(1);
  expect(pinch.camera.z / 1.2).toBeCloseTo(Math.exp(0.1), 2);
  expect(plain.camera.z / 1.2).toBeCloseTo(Math.exp(0.018), 2);
});

test("a release judges the drop where it lifts, without another move", () => {
  const t = setup();
  const cell = t.deskCell(0);
  const floorOf = (room: (typeof t.rooms)[number]) =>
    t.screen({ x: room.x * T + 4, y: (room.y + room.h) * T - 4 });
  const pointer = t.press(t.deskCentre(cell));
  t.moveTo(pointer, offset(t.deskCentre(cell), 20));
  t.moveTo(pointer, floorOf(t.rooms[1]!));
  // Lifted over another room: that room, not the one last aimed at.
  t.lift(pointer, floorOf(t.rooms[2]!));
  expect(t.moves).toEqual([
    { kind: "desk", deskKey: cell.deskKey!, roomKey: t.rooms[2]!.key },
  ]);
});

test("a release after a drawn pan judges the drop against the frame drawn now", () => {
  const t = setup();
  const cell = t.deskCell(0);
  const [aimed, drawnThere] = [t.rooms[1]!, t.rooms[2]!];
  const floor = (room: typeof aimed) => ({
    x: room.x * T + 4,
    y: (room.y + room.h) * T - 4,
  });
  const point = t.screen(floor(aimed));
  const pointer = t.press(t.deskCentre(cell));
  t.moveTo(pointer, offset(t.deskCentre(cell), 20));
  t.moveTo(pointer, point);
  // The camera moves (as an edge pan's last step can) and that frame is
  // drawn: another room's floor is now under the still pointer.
  const from = floor(aimed);
  const to = floor(drawnThere);
  t.camera.x += to.x - from.x;
  t.camera.y += to.y - from.y;
  t.draw();
  t.lift(pointer, point);
  expect(t.moves).toEqual([
    { kind: "desk", deskKey: cell.deskKey!, roomKey: drawnThere.key },
  ]);
});

test("a swipe keeps the ground under the finger, both ways", () => {
  const t = setup();
  const start = { x: 600, y: 4 };
  const ground = t.camera.toWorld(start.x, start.y);
  const pointer = t.press(start, "touch");
  for (const [dx, dy] of [
    [30, 20],
    [-80, 45],
  ] as const) {
    const at = { x: start.x + dx, y: start.y + dy };
    t.time.advance(16);
    t.moveTo(pointer, at, "touch");
    const under = t.camera.toScreen(ground.x, ground.y);
    expect(under.x).toBeCloseTo(at.x);
    expect(under.y).toBeCloseTo(at.y);
  }
  expect(t.reasons).toContain("pan");
});

test("a fast swipe flings the town on, and a new press stops it", () => {
  const t = setup();
  const pointer = t.press({ x: 900, y: 4 }, "touch");
  for (let step = 1; step <= 4; step += 1) {
    t.time.advance(16);
    t.moveTo(pointer, { x: 900 - step * 40, y: 4 }, "touch");
  }
  t.lift(pointer, { x: 740, y: 4 });
  expect(t.reasons).toContain("fling");
  // Dragged left, the town keeps moving left: the camera moves right.
  const x = t.camera.x;
  t.camera.update(1 / 60);
  expect(t.camera.x).toBeGreaterThan(x);
  const pressed = t.press({ x: 900, y: 4 }, "touch");
  const held = t.camera.x;
  t.camera.update(1 / 60);
  expect(t.camera.x).toBe(held);
  t.interaction.up({ id: pressed, at: { x: 900, y: 4 }, cancel: true });
});

test("a pinch keeps the ground between the fingers under their midpoint as it moves", () => {
  const t = setup();
  const a = { x: 600, y: 4 };
  const b = { x: 700, y: 4 };
  const ground = t.camera.toWorld(650, 4);
  const first = t.press(a, "touch");
  const second = t.press(b, "touch", false);
  t.moveTo(first, { x: 560, y: 80 }, "touch");
  t.moveTo(second, { x: 780, y: 120 }, "touch");
  const mid = { x: 670, y: 100 };
  const under = t.camera.toScreen(ground.x, ground.y);
  expect(under.x).toBeCloseTo(mid.x);
  expect(under.y).toBeCloseTo(mid.y);
});

test("staying on the same desk keeps the magnet's time; another desk restarts it", () => {
  const t = setup();
  const cell = t.deskCell(0);
  const other = t.deskCell(1, 0);
  const third = t.deskCell(1, 1);
  const pointer = t.press(t.deskCentre(cell));
  t.moveTo(pointer, offset(t.deskCentre(cell), 20));
  t.moveTo(pointer, t.deskCentre(other));
  t.time.advance(TOWN_MAGNET_MS - 100);
  // A small move on the same desk does not restart the wait.
  t.moveTo(pointer, offset(t.deskCentre(other), 3));
  t.time.advance(100);
  expect(last(t.ghost)?.[3]).toBe("group");
  // Moving to another desk starts a new wait there.
  t.moveTo(pointer, t.deskCentre(third));
  expect(last(t.ghost)?.[3]).not.toBe("group");
  t.time.advance(TOWN_MAGNET_MS - 1);
  expect(last(t.ghost)?.[3]).not.toBe("group");
  t.time.advance(1);
  expect(last(t.ghost)?.[3]).toBe("group");
});

test("a desk held at the edge never snaps to desks the town scrolls under it", () => {
  const t = setup();
  const start = { x: t.camera.x, y: t.camera.y };
  const at = t.deskCentre(t.deskCell(0));
  const pointer = t.press(at);
  t.moveTo(pointer, offset(at, 20));
  // Look below the town, then hold at the top edge in a desk column: the
  // town scrolls down under a still pointer, its desks passing beneath it.
  t.camera.jumpTo(t.camera.x, 1e6, t.camera.z);
  if (t.draw().moved) t.interaction.reaim();
  const edge = { x: at.x, y: 1 };
  t.moveTo(pointer, edge);
  const desks = new Set<string>();
  const aims = new Set<string>();
  for (let frame = 0; frame < 120; frame += 1) {
    t.frames.step();
    // The renderer draws the pan; a camera that moved re-aims the carry.
    if (t.draw().moved) t.interaction.reaim();
    t.time.advance(100);
    const hit = t.interaction.hitAt(edge.x, edge.y);
    if (hit?.kind === "desk") desks.add(hit.key);
    aims.add(String(last(t.ghost)?.[3]));
  }
  // Desks did pass under it, each for longer than the magnet's wait.
  expect(desks.size).toBeGreaterThan(1);
  expect([...aims]).not.toContain("group");
  // Once the town stops under it, resting on a desk still snaps.
  t.moveTo(pointer, { x: 720, y: 450 });
  t.camera.jumpTo(start.x, start.y, t.camera.z);
  if (t.draw().moved) t.interaction.reaim();
  const still = t.deskCentre(t.deskCell(1, 0));
  t.moveTo(pointer, still);
  t.frames.step();
  if (t.draw().moved) t.interaction.reaim();
  t.time.advance(TOWN_MAGNET_MS);
  expect(last(t.ghost)?.[3]).toBe("group");
});

test("a carry held at the edge never snaps, even with frames slower than the magnet's wait", () => {
  const t = setup();
  const at = t.deskCentre(t.deskCell(0));
  const pointer = t.press(at);
  t.moveTo(pointer, offset(at, 20));
  t.camera.jumpTo(t.camera.x, 1e6, t.camera.z);
  if (t.draw().moved) t.interaction.reaim();
  const edge = { x: at.x, y: 1 };
  t.moveTo(pointer, edge);
  const aims = new Set<string>();
  const desks = new Set<string>();
  // A large software-rendered canvas on a busy machine: each frame (one edge
  // pan and one draw) comes after the magnet's wait has passed.
  for (let frame = 0; frame < 40; frame += 1) {
    t.frames.step();
    if (t.draw().moved) t.interaction.reaim();
    t.time.advance(TOWN_MAGNET_MS + 50);
    const hit = t.interaction.hitAt(edge.x, edge.y);
    if (hit?.kind === "desk") desks.add(hit.key);
    aims.add(String(last(t.ghost)?.[3]));
  }
  expect(desks.size).toBeGreaterThan(1);
  expect([...aims]).not.toContain("group");
});

/** Step the camera one frame, draw it and re-aim, as TownCanvas does. */
const frame = (t: ReturnType<typeof setup>) => {
  t.camera.update(0.05);
  if (t.draw().moved) t.interaction.reaim();
};

for (const [motion, start] of [
  ["a keyboard zoom", (t: ReturnType<typeof setup>) => t.view.key("+")],
  [
    "a flight",
    (t: ReturnType<typeof setup>) =>
      t.camera.flyTo(t.camera.x + 200, t.camera.y, t.camera.z),
  ],
] as const)
  test(`a carry never groups while ${motion} is still to be drawn, however slow the frames`, () => {
    const t = setup();
    const cell = t.deskCell(0);
    const other = t.deskCell(1, 0);
    const pointer = t.press(t.deskCentre(cell));
    t.moveTo(pointer, offset(t.deskCentre(cell), 20));
    t.moveTo(pointer, t.deskCentre(other));
    start(t);
    expect(t.camera.moving).toBe(true);
    // Frames further apart than the magnet's wait, while the camera moves.
    for (let step = 0; step < 4 && t.camera.moving; step += 1) {
      frame(t);
      t.time.advance(TOWN_MAGNET_MS + 50);
      expect(last(t.ghost)?.[3]).not.toBe("group");
    }
    while (t.camera.moving) frame(t);
    // Settled: resting on the desk now groups after the ordinary wait.
    const onto = t.deskCentre(other);
    t.moveTo(pointer, onto);
    t.time.advance(TOWN_MAGNET_MS - 1);
    expect(last(t.ghost)?.[3]).not.toBe("group");
    t.time.advance(1);
    expect(last(t.ghost)?.[3]).toBe("group");
    t.lift(pointer, onto);
    expect(t.moves).toEqual([
      { kind: "group", deskKey: cell.deskKey!, targetDeskKey: other.deskKey! },
    ]);
  });

test("a magnet started before the camera moves waits for it to settle", () => {
  const t = setup();
  const cell = t.deskCell(0);
  const onto = t.deskCentre(t.deskCell(1, 0));
  const pointer = t.press(t.deskCentre(cell));
  t.moveTo(pointer, offset(t.deskCentre(cell), 20));
  t.moveTo(pointer, onto);
  // The zoom begins, and its first frame has not come when the wait ends.
  t.view.key("+");
  t.time.advance(TOWN_MAGNET_MS + 50);
  expect(last(t.ghost)?.[3]).not.toBe("group");
  t.lift(pointer, onto);
  expect(t.moves.some((move) => move.kind === "group")).toBe(false);
});

test("disposing a carry cancels its pending magnet", () => {
  const t = setup();
  const cell = t.deskCell(0);
  const pointer = t.press(t.deskCentre(cell));
  t.moveTo(pointer, offset(t.deskCentre(cell), 20));
  t.moveTo(pointer, t.deskCentre(t.deskCell(1, 0)));
  t.interaction.dispose();
  expect(last(t.ghost)?.[0]).toBe("remove");
  const aims = t.ghost.length;
  t.time.advance(TOWN_MAGNET_MS + 50);
  expect(t.ghost.length).toBe(aims);
});

test("a camera that moves under a resting carry restarts the magnet's wait", () => {
  const t = setup();
  const cell = t.deskCell(0);
  const onto = t.deskCentre(t.deskCell(1, 0));
  const pointer = t.press(t.deskCentre(cell));
  t.moveTo(pointer, offset(t.deskCentre(cell), 20));
  t.moveTo(pointer, onto);
  t.time.advance(TOWN_MAGNET_MS - 100);
  // The town moves a little under the still pointer (the same desk stays
  // under it) and that frame is drawn.
  t.camera.x += 1 / t.camera.z;
  expect(t.draw().moved).toBe(true);
  t.interaction.reaim();
  t.time.advance(100);
  expect(last(t.ghost)?.[3]).not.toBe("group");
});

test("an edge pan restarts the magnet's wait between the renderer's draws", () => {
  const t = setup();
  const at = t.deskCentre(t.deskCell(0));
  const pointer = t.press(at);
  t.moveTo(pointer, offset(at, 20));
  t.camera.jumpTo(t.camera.x, 1e6, t.camera.z);
  if (t.draw().moved) t.interaction.reaim();
  const edge = { x: at.x, y: 1 };
  t.moveTo(pointer, edge);
  const aims = new Set<string>();
  const desks = new Set<string>();
  // A slow renderer draws every eighth frame, longer apart than the magnet's
  // wait; the edge pan runs every frame.
  for (let frame = 0; frame < 160; frame += 1) {
    t.frames.step();
    if (frame % 8 === 0 && t.draw().moved) t.interaction.reaim();
    t.time.advance(100);
    const hit = t.interaction.hitAt(edge.x, edge.y);
    if (hit?.kind === "desk") desks.add(hit.key);
    aims.add(String(last(t.ghost)?.[3]));
  }
  expect(desks.size).toBeGreaterThan(1);
  expect([...aims]).not.toContain("group");
});

test("at the room-card zoom a touch held on a desk lifts it, and a tap still opens it", () => {
  const t = setup({ level: "overview" });
  const cell = t.deskCell(0);
  const at = t.deskCentre(cell);
  const pointer = t.press(at, "touch");
  t.time.advance(TOWN_HOLD_MS);
  expect(t.log.find(([kind]) => kind === "begin")?.slice(0, 3)).toEqual([
    "begin",
    "desk",
    cell.deskKey,
  ]);
  t.interaction.up({ id: pointer, at, cancel: true });
  // A tap on the desk is unchanged: it selects (opens) the desk.
  t.time.advance(1000);
  t.lift(t.press(at, "touch"), at);
  expect(t.log).toContainEqual(["select", cell.deskKey]);
});

test("a hold through a room card lifts the desk beneath; a tap on the card zooms its room", () => {
  const t = setup({ level: "overview" });
  const room = t.rooms[0]!;
  const cell = t.deskCell(0);
  const at = t.deskCentre(cell);
  // Held over a desk of the card's room: the desk beneath lifts.
  const pointer = t.press(at, "touch", true, room.key);
  t.time.advance(TOWN_HOLD_MS);
  expect(t.log.find(([kind]) => kind === "begin")?.slice(0, 3)).toEqual([
    "begin",
    "desk",
    cell.deskKey,
  ]);
  t.interaction.up({ id: pointer, at, cancel: true });
  // Tapped: the card's room opens and zooms; the desk is not selected.
  t.log.length = 0;
  t.reasons.length = 0;
  t.time.advance(1000);
  t.lift(t.press(at, "touch", true, room.key), at);
  expect(t.log).toContainEqual(["room", room.key]);
  expect(t.reasons).toContain("room");
  expect(t.log.some(([kind]) => kind === "select")).toBe(false);
  // Over the card but off any desk: a hold lifts nothing.
  t.log.length = 0;
  t.time.advance(1000);
  const floor = t.screen({ x: room.x * T + 4, y: (room.y + room.h) * T - 4 });
  const empty = t.press(floor, "touch", true, room.key);
  t.time.advance(TOWN_HOLD_MS * 2);
  expect(t.log.some(([kind]) => kind === "begin")).toBe(false);
  t.interaction.up({ id: empty, at: floor, cancel: true });
  // A card press never lifts another room's desk beneath it.
  const other = t.rooms[1]!;
  const stray = t.press(at, "touch", true, other.key);
  t.time.advance(TOWN_HOLD_MS * 2);
  expect(t.log.some(([kind]) => kind === "begin")).toBe(false);
  t.interaction.up({ id: stray, at, cancel: true });
});

/** A point on room `index`'s left wall, halfway down, on screen. */
const roomEdge = (t: ReturnType<typeof setup>, index: number) => {
  const room = t.rooms[index]!;
  return t.screen({ x: room.x * T + 3, y: (room.y + room.h / 2) * T });
};

test("a room dragged by its edge goes where it is dropped, waits, then lands", async () => {
  const t = setup();
  const from = t.rooms[0]!;
  const at = roomEdge(t, 0);
  // A mouse over the edge shows the grab hand; over a desk, a pointer.
  t.interaction.move({ id: 99, at, pointerType: "mouse", client: at });
  expect(last(t.log.filter(([kind]) => kind === "cursor"))).toEqual([
    "cursor",
    "grab",
  ]);
  const pointer = t.press(at);
  t.moveTo(pointer, offset(at, 20));
  expect(t.log.find(([kind]) => kind === "begin")?.slice(0, 3)).toEqual([
    "begin",
    "room",
    from.key,
  ]);
  // Back where it was it would go back; anywhere else in its building it
  // goes, held where it was grabbed.
  t.moveTo(pointer, at);
  expect(last(t.ghost)?.[2]).toBe(false);
  // It lifted where the drag began, and keeps that grip.
  const grab = t.camera.toWorld(offset(at, 20).x, offset(at, 20).y);
  const target = t.screen({ x: grab.x + 4 * T, y: grab.y + 6 * T });
  t.moveTo(pointer, target);
  expect(last(t.ghost)?.slice(0, 3)).toEqual([
    "aim",
    `Move ${t.model.rooms.get(from.key)!.displayLabel} here`,
    true,
  ]);
  t.lift(pointer, target);
  const spot = townRoomSpotAt(t.layout, from.key, from.x + 4, from.y + 6)!;
  expect(t.moves).toHaveLength(1);
  const [command] = t.moves;
  expect(command).toMatchObject({ kind: "room", roomKey: from.key });
  const placement = (command as { placement: TownRoomPlacement }).placement;
  expect(placement.spots.get(from.key)).toEqual(spot);
  // The renderer showed where every room would stand.
  expect(last(t.log.filter(([kind]) => kind === "aim"))?.[5]).toBe(placement);
  expect(t.log).toContainEqual(["end", "park"]);
  await Promise.resolve();
  await Promise.resolve();
  expect(t.log).toContainEqual(["finish", "moved"]);
});

test("a room dropped back on its spot, or never over the bin, goes back", () => {
  const t = setup();
  t.setBin(() => true);
  const at = roomEdge(t, 0);
  const pointer = t.press(at);
  t.moveTo(pointer, offset(at, 30, 10));
  // The bin takes desks and agents, never a room.
  expect(last(t.ghost)?.[3]).not.toBe("bin");
  t.moveTo(pointer, at);
  t.lift(pointer, at);
  expect(t.moves).toEqual([]);
  expect(t.binned).toEqual([]);
  expect(t.log).toContainEqual(["end", "cancel"]);
});

test("a room's name carries the room: dragged, or held by a touch; a tap is the plate's own", () => {
  const t = setup();
  const room = t.rooms[1]!;
  const name = t.screen({
    x: (room.x + room.w / 2) * T,
    y: (room.y + 0.5) * T,
  });
  const down = (pointerType: string) => {
    const id = 500 + t.log.length;
    t.interaction.down({
      id,
      at: name,
      primary: true,
      pointerType,
      roomName: room.key,
    });
    return id;
  };
  // A click on the plate's name neither zooms nor selects.
  t.lift(down("mouse"), name);
  expect(t.log.some(([kind]) => kind === "room" || kind === "select")).toBe(
    false,
  );
  t.time.advance(1000);
  // A touch held still lifts the room.
  const touch = down("touch");
  t.time.advance(TOWN_HOLD_MS);
  expect(t.log).toContainEqual(["held"]);
  expect(t.log.find(([kind]) => kind === "begin")?.slice(0, 3)).toEqual([
    "begin",
    "room",
    room.key,
  ]);
  const target = roomEdge(t, 0);
  t.moveTo(touch, target, "touch");
  t.lift(touch, target);
  expect(t.moves).toHaveLength(1);
  expect(t.moves[0]).toMatchObject({ kind: "room", roomKey: room.key });
});

test("a room's Move handle lifts it at once, by touch too; a tap puts it back", () => {
  const t = setup();
  const room = t.rooms[1]!;
  const handle = t.screen({ x: (room.x + 2) * T, y: (room.y - 1) * T });
  const down = (pointerType: string) => {
    const id = 800 + t.log.length;
    t.interaction.down({
      id,
      at: handle,
      primary: true,
      pointerType,
      roomName: room.key,
      handle: true,
    });
    return id;
  };
  // A touch on the handle needs no hold: the room lifts at once.
  const touch = down("touch");
  expect(t.log.find(([kind]) => kind === "begin")?.slice(0, 3)).toEqual([
    "begin",
    "room",
    room.key,
  ]);
  // Let go without moving: it goes back, and nothing zooms or opens.
  t.lift(touch, handle);
  expect(t.moves).toEqual([]);
  expect(t.log).toContainEqual(["end", "cancel"]);
  expect(t.log.some(([kind]) => kind === "room" || kind === "select")).toBe(
    false,
  );
  // Dragged, it goes where it is dropped.
  t.time.advance(1000);
  const again = down("touch");
  const target = offset(handle, 0, 9 * T * 1.2);
  t.moveTo(again, target, "touch");
  t.lift(again, target);
  expect(t.moves).toHaveLength(1);
  expect(t.moves[0]).toMatchObject({ kind: "room", roomKey: room.key });
});

test("a room card's name carries the room, and a tap there still zooms it", () => {
  const t = setup({ level: "overview", zoom: 0.4 });
  const room = t.rooms[2]!;
  const at = t.screen({ x: (room.x + room.w / 2) * T, y: (room.y + 1) * T });
  const tap = 700;
  t.interaction.down({
    id: tap,
    at,
    primary: true,
    pointerType: "mouse",
    card: room.key,
    roomName: room.key,
  });
  t.lift(tap, at);
  expect(t.log).toContainEqual(["room", room.key]);
  t.time.advance(1000);
  t.interaction.down({
    id: tap + 1,
    at,
    primary: true,
    pointerType: "mouse",
    card: room.key,
    roomName: room.key,
  });
  t.moveTo(tap + 1, offset(at, 30));
  expect(t.log.find(([kind]) => kind === "begin")?.slice(0, 3)).toEqual([
    "begin",
    "room",
    room.key,
  ]);
});

test("Escape puts a carried room back, and letting go then does nothing", () => {
  const t = setup();
  const at = roomEdge(t, 0);
  const pointer = t.press(at);
  t.moveTo(pointer, offset(at, 20));
  const onto = roomEdge(t, 1);
  t.moveTo(pointer, onto);
  expect(t.interaction.cancelCarry()).toBe(true);
  expect(t.log).toContainEqual(["end", "cancel"]);
  expect(last(t.ghost)).toEqual(["remove"]);
  t.lift(pointer, onto);
  expect(t.moves).toEqual([]);
  // Nothing carried: Escape is left to whatever else uses it.
  expect(t.interaction.cancelCarry()).toBe(false);
});
