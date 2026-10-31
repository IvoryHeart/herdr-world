import { expect, test } from "bun:test";
import type { HerdrOfficeProjection } from "../../herdrOfficeProjection";
import { TownCamera } from "../townCamera";
import {
  layoutTown,
  TOWN_TILE as T,
  townGeometryKey,
  townShapeFor,
  townShapeKey,
} from "../townLayout";
import { townModelFromProjection } from "../townModel";
import type { TownTarget } from "../townTargets";
import { office, working } from "./townScene.fixture";
import {
  TownSceneCamera,
  townViewport,
  type TownPose,
} from "./townSceneCamera";

const WIDE = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const NO_CHROME = { left: 0, right: 0 };

const town = office({
  alpha: working(6),
  beta: working(3),
  gamma: working(2),
  delta: working(4),
});

function layoutFor(
  projection: HerdrOfficeProjection,
  size: { width: number; height: number },
) {
  return layoutTown(
    townModelFromProjection(projection).input,
    townShapeFor(size.width, size.height),
    new Map(),
    new Map(),
  ).layout;
}

function setup(
  size = WIDE,
  poses = new Map<string, TownPose>(),
  projection = town,
) {
  const reasons: string[] = [];
  const view = new TownSceneCamera(poses, (reason) => reasons.push(reason));
  const layout = layoutFor(projection, size);
  const viewport = townViewport(size.width, size.height, NO_CHROME);
  const camera = new TownCamera();
  camera.viewport = viewport;
  return { view, layout, viewport, camera, reasons, poses };
}

/** Let a flight finish, as the renderer's frames would. */
function settle(camera: TownCamera) {
  for (let frame = 0; frame < 600 && camera.flying; frame += 1)
    camera.update(1 / 60);
  camera.update(1 / 60);
  expect(camera.flying).toBe(false);
}

test("intents wait for a ready camera", () => {
  const { view, layout, viewport, reasons } = setup();
  view.frameHome(layout, viewport, false);
  view.stepZoom(1, layout, viewport);
  view.fitAll(layout);
  view.zoomToRoom(layout, layout.buildings[0]!.rooms[0]!.key);
  expect(view.key("ArrowLeft")).toBe(false);
  view.roomFocus(
    { roomKey: layout.buildings[0]!.rooms[0]!.key, seq: 1 },
    layout,
  );
  expect(reasons).toEqual([]);
});

test("a wide town opens at home: every building, centred", () => {
  const { view, layout, viewport, camera, reasons } = setup();
  view.attach(camera, layout, viewport);
  expect(camera.z).toBe(camera.limits!.home);
  // The town's centre sits at the focus point, between the panels' insets.
  const centre = camera.toScreen(
    (layout.width * T) / 2,
    (layout.height * T) / 2,
  );
  expect(centre.x).toBeCloseTo(camera.focusPoint().x);
  expect(centre.y).toBeCloseTo(camera.focusPoint().y);
  expect(view.atHome()).toBe(true);
  expect(reasons).toEqual(["home"]);
});

test("a phone opens at home: the first building's top under the top inset", () => {
  const { view, layout, viewport, camera } = setup(PHONE);
  expect(layout.formFactor).toBe("narrow");
  view.attach(camera, layout, viewport);
  const first = layout.buildings[0]!;
  expect(camera.z).toBe(camera.limits!.home);
  expect(camera.toScreen(0, first.y * T - 24).y).toBeCloseTo(
    viewport.inset.top,
  );
  expect(view.atHome()).toBe(true);
});

test("each town shape keeps its own camera across visits", () => {
  const poses = new Map<string, TownPose>();
  const first = setup(WIDE, poses);
  first.view.attach(first.camera, first.layout, first.viewport);
  expect(first.view.key("ArrowLeft")).toBe(true);
  first.camera.update(1 / 60);
  first.view.drew(first.camera, "overview", first.layout);
  const kept = { x: first.camera.x, y: first.camera.y, z: first.camera.z };
  expect(poses.get(townShapeKey(first.layout.shape))).toEqual(kept);
  // A later visit opens where the last one left, not at home.
  const again = setup(WIDE, poses);
  again.view.attach(again.camera, again.layout, again.viewport);
  expect({ x: again.camera.x, y: again.camera.y, z: again.camera.z }).toEqual(
    kept,
  );
  expect(again.reasons).toEqual([]);
  // A new shape frames its own home; coming back restores the wide pose.
  const phone = layoutFor(town, PHONE);
  const phoneViewport = townViewport(PHONE.width, PHONE.height, NO_CHROME);
  again.camera.viewport = phoneViewport;
  again.view.follow(phone, phoneViewport);
  expect(again.reasons).toEqual(["home"]);
  expect(again.camera.z).toBe(again.camera.limits!.home);
  again.camera.viewport = again.viewport;
  again.view.follow(again.layout, again.viewport);
  // As before the scene model: the saved centre returns at the focus point.
  expect(again.camera.z).toBe(kept.z);
  const back = again.camera.toScreen(kept.x, kept.y);
  expect(back.x).toBeCloseTo(again.camera.focusPoint().x);
  expect(back.y).toBeCloseTo(again.camera.focusPoint().y);
});

test("a drawn frame reports movement and saves only a changed pose", () => {
  const { view, layout, viewport, camera, poses } = setup();
  view.attach(camera, layout, viewport);
  expect(view.drew(camera, "overview", layout)).toEqual({
    moved: true,
    posed: true,
  });
  expect(view.drawn).toEqual({
    x: camera.x,
    y: camera.y,
    z: camera.z,
    width: viewport.width,
    height: viewport.height,
  });
  poses.clear();
  expect(view.drew(camera, "overview", layout)).toEqual({
    moved: false,
    posed: false,
  });
  expect(poses.size).toBe(0);
  // Below the saved precision a pan moves the drawn camera but not the pose.
  camera.x += 0.01;
  expect(view.drew(camera, "overview", layout)).toEqual({
    moved: true,
    posed: false,
  });
});

test("keys pan by 60 screen pixels and zoom about the centre", () => {
  const { view, layout, viewport, camera, reasons } = setup();
  view.attach(camera, layout, viewport);
  reasons.length = 0;
  view.stepZoom(1, layout, viewport);
  settle(camera);
  const { x, y, z } = camera;
  expect(view.key("ArrowRight")).toBe(true);
  camera.update(1 / 60);
  expect(camera.x - x).toBeCloseTo(60 / z);
  expect(camera.y).toBeCloseTo(y);
  expect(view.key("+")).toBe(true);
  expect(view.key("x")).toBe(false);
  expect(reasons).toEqual(["zoom-step", "keyboard", "keyboard"]);
});

test("on a phone, zoom out steps to the whole town and zoom in comes home", () => {
  const { view, layout, viewport, camera } = setup(PHONE);
  view.attach(camera, layout, viewport);
  const limits = camera.limits!;
  expect(limits.all).toBeLessThan(limits.home * 0.93);
  view.stepZoom(-1, layout, viewport);
  settle(camera);
  expect(camera.z).toBeCloseTo(limits.all);
  view.stepZoom(1, layout, viewport);
  settle(camera);
  expect(camera.z).toBeCloseTo(limits.home);
});

test("zoom in steps from home to a building, a room and a desk, then zooms", () => {
  const { view, layout, viewport, camera, reasons } = setup();
  view.attach(camera, layout, viewport);
  const limits = camera.limits!;
  const zooms = [camera.z];
  for (let step = 0; step < 4; step += 1) {
    view.stepZoom(1, layout, viewport);
    settle(camera);
    zooms.push(camera.z);
  }
  // Each step goes at least 1.2 times closer; the desk step is past desk zoom.
  for (let index = 1; index < 4; index += 1)
    expect(zooms[index]!).toBeGreaterThanOrEqual(
      zooms[index - 1]! * 1.2 - 1e-9,
    );
  expect(zooms[3]!).toBeGreaterThanOrEqual(limits.desk * 1.2 - 1e-9);
  expect(reasons).toEqual([
    "home",
    "zoom-step",
    "zoom-step",
    "zoom-step",
    "zoom",
  ]);
  // Zoom out from the desk comes back step by step, through home.
  reasons.length = 0;
  for (let step = 0; step < 4; step += 1) {
    view.stepZoom(-1, layout, viewport);
    settle(camera);
  }
  expect(camera.z).toBeCloseTo(limits.home);
  // Room, building, home; then home again, as a wide town has no whole step.
  expect(reasons).toEqual([
    "zoom-step",
    "zoom-step",
    "home",
    "zoom-step",
    "home",
  ]);
  // A wide town has no step out past home: zoom out frames home again.
  reasons.length = 0;
  view.stepZoom(-1, layout, viewport);
  expect(reasons).toEqual(["home"]);
});

const target = (x: number, y: number): TownTarget => ({
  key: "t",
  kind: "desk",
  label: "t",
  rect: { x, y, width: 10, height: 10 },
  canActivate: true,
});

test("focusing a target moves the camera only when it is near an edge or the town is far", () => {
  const { view, layout, viewport, camera, reasons } = setup();
  view.attach(camera, layout, viewport);
  reasons.length = 0;
  view.focusTarget(target(camera.x - 5, camera.y - 5));
  expect(camera.flying).toBe(false);
  const edge = camera.toWorld(10, 10);
  view.focusTarget(target(edge.x, edge.y));
  expect(camera.flying).toBe(true);
  settle(camera);
  // At town level, even a centred target brings the camera to card zoom.
  view.drew(camera, "town", layout);
  view.focusTarget(target(camera.x - 5, camera.y - 5));
  expect(camera.flying).toBe(true);
  expect(reasons).toEqual(["focus", "focus"]);
});

test("a room request runs once per seq, when the camera and room are ready", () => {
  const { view, layout, viewport, camera, reasons } = setup();
  const roomKey = layout.buildings[0]!.rooms[1]!.key;
  view.roomFocus({ roomKey, seq: 1 }, layout);
  expect(reasons).toEqual([]);
  view.attach(camera, layout, viewport);
  reasons.length = 0;
  view.roomFocus({ roomKey, seq: 1 }, layout);
  expect(reasons).toEqual(["room"]);
  settle(camera);
  view.fitAll(layout);
  settle(camera);
  // The same request never replays, even when its room leaves and returns.
  const without = layoutFor(
    office({ alpha: working(6), gamma: working(2), delta: working(4) }),
    WIDE,
  );
  view.roomFocus({ roomKey, seq: 1 }, without);
  view.roomFocus({ roomKey, seq: 1 }, layout);
  expect(camera.flying).toBe(false);
  // A new request moves again; one for a missing room waits for it.
  view.roomFocus({ roomKey, seq: 2 }, without);
  expect(camera.flying).toBe(false);
  view.roomFocus({ roomKey, seq: 2 }, layout);
  expect(camera.flying).toBe(true);
  expect(reasons).toEqual(["room", "fit", "room"]);
});

test("panels re-frame the town only while it is still at home", () => {
  const { view, layout, viewport, camera, reasons } = setup();
  view.attach(camera, layout, viewport);
  const docked = townViewport(WIDE.width, WIDE.height, { left: 0, right: 420 });
  const apply = (next: typeof viewport) => camera.configure(layout, next);
  reasons.length = 0;
  view.reframe(layout, docked, apply);
  expect(reasons).toEqual(["home"]);
  expect(camera.viewport).toBe(docked);
  expect(view.atHome()).toBe(true);
  view.key("ArrowLeft");
  camera.update(1 / 60);
  reasons.length = 0;
  view.reframe(layout, viewport, apply);
  expect(reasons).toEqual([]);
  expect(camera.viewport).toBe(viewport);
});

test("rooms that move under a still camera keep the room in view where it was", () => {
  const { view, layout, viewport, camera, reasons } = setup();
  view.attach(camera, layout, viewport);
  view.follow(layout, viewport);
  const grown = layoutTown(
    townModelFromProjection(
      office({
        alpha: working(24),
        beta: working(3),
        gamma: working(2),
        delta: working(4),
      }),
    ).input,
    layout.shape,
    new Map(),
    new Map(),
  ).layout;
  expect(townGeometryKey(grown)).not.toBe(townGeometryKey(layout));
  // Look at the last room, which the growth moves.
  const rooms = layout.buildings[0]!.rooms;
  const last = rooms[rooms.length - 1]!;
  const moved = grown.buildings[0]!.rooms.find(
    (room) => room.key === last.key,
  )!;
  expect([moved.x, moved.y]).not.toEqual([last.x, last.y]);
  camera.jumpTo((last.x + last.w / 2) * T, (last.y + last.h / 2) * T, 2);
  const before = camera.toScreen((last.x + 1) * T, (last.y + 1) * T);
  reasons.length = 0;
  view.follow(grown, viewport);
  const after = camera.toScreen((moved.x + 1) * T, (moved.y + 1) * T);
  expect(reasons).toEqual(["reflow"]);
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
});

test("Show the whole town flies to fit every building", () => {
  const { view, layout, viewport, camera, reasons } = setup();
  view.attach(camera, layout, viewport);
  view.stepZoom(1, layout, viewport);
  settle(camera);
  reasons.length = 0;
  view.fitAll(layout);
  settle(camera);
  expect(camera.z).toBeCloseTo(camera.limits!.all);
  expect(reasons).toEqual(["fit"]);
});

test("on a phone, Show the whole town zooms out past home", () => {
  const { view, layout, viewport, camera } = setup(PHONE);
  view.attach(camera, layout, viewport);
  view.fitAll(layout);
  settle(camera);
  expect(camera.z).toBeCloseTo(camera.limits!.all);
  expect(camera.z).toBeLessThan(camera.limits!.home * 0.93);
});

test("a reflow during a camera flight leaves the flight alone", () => {
  const { view, layout, viewport, camera, reasons } = setup();
  view.attach(camera, layout, viewport);
  view.follow(layout, viewport);
  view.stepZoom(1, layout, viewport);
  expect(camera.flying).toBe(true);
  const grown = layoutTown(
    townModelFromProjection(
      office({
        alpha: working(24),
        beta: working(3),
        gamma: working(2),
        delta: working(4),
      }),
    ).input,
    layout.shape,
    new Map(),
    new Map(),
  ).layout;
  reasons.length = 0;
  view.follow(grown, viewport);
  expect(reasons).toEqual([]);
  expect(camera.flying).toBe(true);
});

test("a target at the right or bottom edge is brought into view", () => {
  for (const [sx, sy] of [
    [WIDE.width - 30, WIDE.height / 2],
    [WIDE.width / 2, WIDE.height - 30],
  ] as const) {
    const { view, layout, viewport, camera } = setup();
    view.attach(camera, layout, viewport);
    const edge = camera.toWorld(sx, sy);
    view.focusTarget(target(edge.x - 5, edge.y - 5));
    expect(camera.flying).toBe(true);
  }
});

test("only an instant home framing counts as home for re-framing", () => {
  const { view, layout, viewport, camera, reasons } = setup();
  view.attach(camera, layout, viewport);
  // Under reduced motion a zoom step back home jumps there, but it is a
  // step the user took, so opening a panel leaves the camera where it is.
  camera.reducedMotion = true;
  view.stepZoom(1, layout, viewport);
  view.stepZoom(-1, layout, viewport);
  expect(camera.z).toBeCloseTo(camera.limits!.home);
  reasons.length = 0;
  view.reframe(
    layout,
    townViewport(WIDE.width, WIDE.height, { left: 0, right: 420 }),
    (next) => camera.configure(layout, next),
  );
  expect(reasons).toEqual([]);
});
