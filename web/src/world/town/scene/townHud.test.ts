import { expect, test } from "bun:test";
import { TownCamera } from "../townCamera";
import {
  layoutTown,
  TOWN_TILE as T,
  townSeat,
  townShapeFor,
} from "../townLayout";
import { townModelFromProjection } from "../townModel";
import { townVisibleHosts } from "../townVisibleHosts";
import { manualClock, town, working } from "./townScene.fixture";
import {
  TOWN_AGES_MS,
  TownHud,
  townScreenAnchor,
  townWorldAnchor,
} from "./townHud";
import { townViewport } from "./townSceneCamera";

function setup() {
  const projection = town({
    studio: { alpha: working(3), beta: working(2) },
    lab: { gamma: working(2) },
  });
  const model = townModelFromProjection(projection);
  const layout = layoutTown(
    model.input,
    townShapeFor(1440, 900),
    new Map(),
    new Map(),
  ).layout;
  const camera = new TownCamera();
  camera.configure(layout, townViewport(1440, 900, { left: 0, right: 0 }));
  camera.jumpTo((layout.width * T) / 2, (layout.height * T) / 2, 1.2);
  const time = manualClock();
  const hud = new TownHud(time.clock);
  const published: string[] = [];
  for (const topic of ["visible", "level", "ages"] as const)
    hud.subscribe(topic, () => published.push(topic));
  return { model, layout, camera, time, hud, published };
}

test("drawn frames publish what is on screen only when it changes", () => {
  const { layout, camera, hud, published } = setup();
  hud.drew(camera, "room", layout);
  expect(hud.visible).toEqual(townVisibleHosts(camera, layout, "room"));
  expect(published).toEqual(["visible", "level"]);
  // Idle and small pans: the same buildings and rooms, nothing published.
  published.length = 0;
  for (let frame = 0; frame < 30; frame += 1) {
    camera.panBy(0.5, 0);
    hud.drew(camera, "room", layout);
  }
  expect(published).toEqual([]);
  // From room level to desk level room cards hide: what is on screen
  // changes, and the level, each published once.
  hud.drew(camera, "desk", layout);
  hud.drew(camera, "desk", layout);
  expect(published).toEqual(["visible", "level"]);
  expect(hud.visible.cards).toBe(false);
  expect(hud.level).toBe("desk");
});

test("frame followers hear every drawn frame until they stop", () => {
  const { hud } = setup();
  let heard = 0;
  const stop = hud.onFrame(() => (heard += 1));
  hud.framed();
  hud.framed();
  stop();
  hud.framed();
  expect(heard).toBe(2);
});

test("ages move on every 15 s while shown, and stop when nothing shows them", () => {
  const { time, hud, published } = setup();
  // The cadence the waiting ages have always moved on.
  expect(TOWN_AGES_MS).toBe(15_000);
  const start = hud.now();
  time.advance(TOWN_AGES_MS * 3);
  expect(published).toEqual([]);
  const first = hud.showAges();
  const second = hud.showAges();
  time.advance(TOWN_AGES_MS - 1);
  expect(published).toEqual([]);
  time.advance(1);
  expect(published).toEqual(["ages"]);
  expect(hud.ages).toBe(start + TOWN_AGES_MS * 4);
  // One of two stops showing them: the clock keeps going.
  first();
  first();
  time.advance(TOWN_AGES_MS);
  expect(published).toEqual(["ages", "ages"]);
  // The last stops: no more ticks.
  second();
  time.advance(TOWN_AGES_MS * 4);
  expect(published).toEqual(["ages", "ages"]);
  expect(time.pending()).toBe(0);
  // Shown again later: ages restart from now.
  const third = hud.showAges();
  expect(hud.ages).toBe(hud.now());
  time.advance(TOWN_AGES_MS);
  expect(published.length).toBe(3);
  third();
});

test("an inspected agent's anchors are its seat and its desk, or where it stands", () => {
  const { model, layout } = setup();
  const [agentKey, seat] = [...model.agentSeats][0]!;
  const cell = layout.buildings
    .flatMap((b) => b.rooms.flatMap((r) => r.cells))
    .find((entry) => entry.deskKey === seat.deskKey)!;
  const geometry = townSeat(cell, seat.seat);
  const seated = townWorldAnchor(agentKey, model, layout, () => ({
    x: 0,
    y: 0,
    seated: true,
  }));
  expect(seated.agent).toEqual({
    x: geometry.cx,
    y: geometry.top ? geometry.tableY + 6 : geometry.tableY + 40,
  });
  expect(seated.workbench).toEqual({
    x: (cell.x + 3) * T,
    y: cell.y * T + 28,
  });
  const standing = townWorldAnchor(agentKey, model, layout, () => ({
    x: 100,
    y: 200,
    seated: false,
  }));
  expect(standing.agent).toEqual({ x: 100, y: 188 });
  // A desk key anchors only its workbench; nothing anchors nothing.
  const desk = townWorldAnchor(seat.deskKey, model, layout, () => null);
  expect(desk.agent).toBeNull();
  expect(desk.workbench).toEqual(seated.workbench);
  expect(townWorldAnchor(null, model, layout, () => null)).toEqual({
    agent: null,
    workbench: null,
  });
});

test("screen anchors stay 10 px inside the town and name the edge they are past", () => {
  const rect = { left: 100, top: 50, right: 500, bottom: 350 };
  const at = (x: number, y: number) =>
    townScreenAnchor(
      { x, y },
      { toScreen: (wx, wy) => ({ x: wx, y: wy }) },
      rect,
    );
  expect(at(200, 100)).toEqual({ x: 300, y: 150, visible: true, edge: null });
  expect(at(-200, 100)).toEqual({
    x: 110,
    y: 150,
    visible: false,
    edge: "left",
  });
  expect(at(900, 100)).toEqual({
    x: 490,
    y: 150,
    visible: false,
    edge: "right",
  });
  expect(at(200, -100)).toEqual({ x: 300, y: 60, visible: false, edge: "top" });
  expect(at(200, 900)).toEqual({
    x: 300,
    y: 340,
    visible: false,
    edge: "bottom",
  });
  expect(
    townScreenAnchor(null, { toScreen: () => ({ x: 0, y: 0 }) }, rect),
  ).toBeNull();
});
