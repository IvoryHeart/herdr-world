import { expect, test } from "bun:test";
import { TownCamera } from "./townCamera";
import { layoutTown, TOWN_TILE as T, townShapeFor } from "./townLayout";
import { townModelFromProjection } from "./townModel";
import {
  townRectOnScreen,
  townSearchLight,
  townSearchOffscreen,
  townSearchRect,
} from "./townSearch";
import { town, working } from "./scene/townScene.fixture";
import { townSearchLabel } from "./useTownSearch";
import {
  TownSceneCamera,
  townViewport,
  type TownPose,
} from "./scene/townSceneCamera";

const WIDE = { width: 1440, height: 900 };

function scene() {
  const projection = town({
    north: { alpha: working(4), beta: working(3) },
    south: { gamma: working(2) },
  });
  const model = townModelFromProjection(projection);
  const { layout } = layoutTown(
    model.input,
    townShapeFor(WIDE.width, WIDE.height),
    new Map(),
    new Map(),
  );
  return { model, layout };
}

const noActors = () => null;

test("a search lights its matches' rooms and buildings", () => {
  const { model, layout } = scene();
  const room = layout.buildings[0]!.rooms[0]!;
  const agent = [...model.agents.values()].find(
    (candidate) => candidate.roomKey !== room.key,
  )!;
  const desk = [...model.desks.values()].find(
    (candidate) => candidate.hostKey !== agent.hostKey,
  )!;
  const light = townSearchLight(model, [room.key, agent.key, desk.key]);
  expect(light.keys).toEqual(new Set([room.key, agent.key, desk.key]));
  expect(light.rooms).toEqual(new Set([room.key, agent.roomKey, desk.roomKey]));
  expect(light.hosts).toEqual(
    new Set([room.hostKey, agent.hostKey, desk.hostKey]),
  );
  expect(light.pulse).toBeNull();
  // A building found by name lights itself.
  expect(townSearchLight(model, [desk.hostKey]).hosts).toEqual(
    new Set([desk.hostKey]),
  );
});

test("each match is drawn where it is: room, table, agent and building", () => {
  const { model, layout } = scene();
  const building = layout.buildings[0]!;
  const room = building.rooms[0]!;
  expect(townSearchRect(room.key, model, layout, noActors)).toEqual({
    x: room.x * T,
    y: room.y * T,
    w: room.w * T,
    h: room.h * T,
  });
  const cell = room.cells.find((candidate) => candidate.deskKey)!;
  expect(townSearchRect(cell.deskKey!, model, layout, noActors)).toEqual({
    x: cell.x * T,
    y: cell.y * T,
    w: 6 * T,
    h: 4 * T,
  });
  // An agent stands where it is drawn; one not drawn yet is at its table.
  const agent = [...model.agents.values()].find(
    (candidate) => candidate.deskKey === cell.deskKey,
  )!;
  expect(
    townSearchRect(agent.key, model, layout, () => ({
      x: 500,
      y: 300,
      seated: false,
    })),
  ).toEqual({ x: 490, y: 272, w: 20, h: 32 });
  expect(townSearchRect(agent.key, model, layout, noActors)).toEqual(
    townSearchRect(cell.deskKey!, model, layout, noActors),
  );
  const whole = townSearchRect(building.hostKey, model, layout, noActors)!;
  expect(whole.x).toBe(building.x * T);
  expect(whole.h).toBeGreaterThan(building.h * T);
  expect(townSearchRect("not drawn", model, layout, noActors)).toBeNull();
});

test("matches outside the view, or not drawn, count as off-screen", () => {
  const { model, layout } = scene();
  const camera = new TownCamera();
  camera.viewport = townViewport(WIDE.width, WIDE.height, {
    left: 0,
    right: 0,
  });
  camera.configure(layout, camera.viewport);
  const [first, second] = layout.buildings;
  // Look closely at the first building's first room only.
  const room = first!.rooms[0]!;
  camera.jumpTo(
    (room.x + room.w / 2) * T,
    (room.y + room.h / 2) * T,
    camera.limits!.max,
  );
  const keys = [room.key, second!.rooms[0]!.key, "not drawn"];
  const count = townSearchOffscreen(
    keys,
    (key) => townSearchRect(key, model, layout, noActors),
    (rect) => townRectOnScreen(rect, camera),
  );
  expect(count).toBe(2);
  camera.jumpTo((layout.width * T) / 2, (layout.height * T) / 2, 0.01);
  expect(
    townSearchOffscreen(
      keys,
      (key) => townSearchRect(key, model, layout, noActors),
      (rect) => townRectOnScreen(rect, camera),
    ),
  ).toBe(1);
});

function settle(camera: TownCamera) {
  for (let frame = 0; frame < 600 && camera.moving; frame += 1)
    camera.update(1 / 60);
  camera.update(1 / 60);
}

test("choosing a match flies there once per seq; ending the search flies back", () => {
  const { model, layout } = scene();
  const reasons: string[] = [];
  const view = new TownSceneCamera(new Map<string, TownPose>(), (reason) =>
    reasons.push(reason),
  );
  const camera = new TownCamera();
  const viewport = townViewport(WIDE.width, WIDE.height, {
    left: 0,
    right: 0,
  });
  camera.viewport = viewport;
  view.attach(camera, layout, viewport);
  const home = { x: camera.x, y: camera.y, z: camera.z };
  reasons.length = 0;
  const desk = layout.buildings[1]!.rooms[0]!.cells.find(
    (cell) => cell.deskKey,
  )!;
  const rect = townSearchRect(desk.deskKey!, model, layout, noActors)!;
  view.searchFocus({ key: desk.deskKey!, seq: 1 }, rect, layout, false);
  expect(camera.flying).toBe(true);
  settle(camera);
  // Readable: at least desk level, with the table on screen.
  expect(camera.z).toBeGreaterThanOrEqual(camera.limits!.desk);
  expect(townRectOnScreen(rect, camera)).toBe(true);
  // The same request never replays; ending the search returns home.
  view.searchFocus({ key: desk.deskKey!, seq: 1 }, rect, layout, false);
  expect(camera.flying).toBe(false);
  view.searchEnd(false);
  settle(camera);
  expect(camera.x).toBeCloseTo(home.x, 3);
  expect(camera.y).toBeCloseTo(home.y, 3);
  expect(camera.z).toBeCloseTo(home.z, 5);
  expect(reasons).toEqual(["search", "search"]);
  // Calm jumps; a search that never moved the camera leaves it be.
  view.searchFocus({ key: desk.deskKey!, seq: 2 }, rect, layout, true);
  expect(camera.flying).toBe(false);
  expect(townRectOnScreen(rect, camera)).toBe(true);
  view.searchEnd(true);
  expect(camera.x).toBeCloseTo(home.x, 3);
  reasons.length = 0;
  view.searchEnd(false);
  expect(reasons).toEqual([]);
});

test("a room or building match is shown whole", () => {
  const { model, layout } = scene();
  const view = new TownSceneCamera(new Map(), () => undefined);
  const camera = new TownCamera();
  const viewport = townViewport(WIDE.width, WIDE.height, {
    left: 0,
    right: 0,
  });
  camera.viewport = viewport;
  view.attach(camera, layout, viewport);
  const room = layout.buildings[1]!.rooms[0]!;
  const rect = townSearchRect(room.key, model, layout, noActors)!;
  view.searchFocus({ key: room.key, seq: 1 }, rect, layout, true);
  const corner = camera.toScreen(rect.x, rect.y);
  const far = camera.toScreen(rect.x + rect.w, rect.y + rect.h);
  expect(corner.x).toBeGreaterThanOrEqual(0);
  expect(corner.y).toBeGreaterThanOrEqual(0);
  expect(far.x).toBeLessThanOrEqual(viewport.width);
  expect(far.y).toBeLessThanOrEqual(viewport.height);
});

test("the result line counts matches and those off-screen", () => {
  expect(townSearchLabel(7, 3)).toBe("7 matches · 3 off-screen");
  expect(townSearchLabel(1, 0)).toBe("1 match");
  expect(townSearchLabel(0, 0)).toBe("No matches");
});
