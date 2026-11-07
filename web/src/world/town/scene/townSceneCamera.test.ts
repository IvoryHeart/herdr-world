import { expect, test } from "bun:test";
import type { HerdrOfficeProjection } from "../../herdrOfficeProjection";
import { TownCamera, townHostsWidth } from "../townCamera";
import { townCenterEmblem } from "../townCenter";
import {
  TOWN_FACADE,
  TOWN_PHONE_BOARD_ROWS,
  layoutTown,
  TOWN_TILE as T,
  townGeometryKey,
  townShapeFor,
  townShapeKey,
} from "../townLayout";
import { townModelFromProjection } from "../townModel";
import type { TownTarget } from "../townTargets";
import { office, town as townOf, working } from "./townScene.fixture";
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
  for (let frame = 0; frame < 600 && camera.moving; frame += 1)
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
  // The hosts' centre sits at the focus point, between the panels' insets;
  // the verge beyond them lies off-screen, and ALL shows it.
  expect(camera.limits!.home).toBeGreaterThanOrEqual(camera.limits!.all);
  const usable = viewport.width - viewport.inset.left - viewport.inset.right;
  const fits = layout.width * T * camera.z <= usable;
  if (!fits)
    expect(camera.toScreen(0, 0).x).toBeLessThanOrEqual(
      viewport.inset.left + 0.01,
    );
  const centre = camera.toScreen(
    fits
      ? (layout.width * T) / 2
      : Math.max(
          (townHostsWidth(layout) * T) / 2,
          (camera.focusPoint().x - viewport.inset.left) / camera.z,
        ),
    (layout.height * T) / 2,
  );
  expect(centre.x).toBeCloseTo(camera.focusPoint().x);
  expect(centre.y).toBeCloseTo(camera.focusPoint().y);
  // The town center stands among the buildings, its plaque on screen.
  const plaque = townCenterEmblem(layout.center, T);
  const sign = camera.toScreen(plaque.x, plaque.y);
  expect(sign.x).toBeGreaterThan(viewport.inset.left);
  expect(sign.x).toBeLessThan(viewport.width - viewport.inset.right);
  expect(sign.y).toBeGreaterThan(viewport.inset.top);
  expect(sign.y).toBeLessThan(viewport.height - viewport.inset.bottom);
  expect(view.atHome()).toBe(true);
  expect(reasons).toEqual(["home"]);
});

test("a phone opens at home: the town center on top, the first building under it", () => {
  for (const [size, projection, framed] of [
    // A short first building fits whole under the whole center.
    [{ width: 390, height: 1200 }, office({ alpha: working(2) }), "flag"],
    // A taller one keeps its lounge, where idle agents rest, in view.
    [{ width: 390, height: 844 }, office({ alpha: working(2) }), "lounge"],
    // One taller than the screen leaves the center its plaque and doors.
    [PHONE, town, "plaque"],
  ] as const) {
    const { view, layout, viewport, camera } = setup(
      size,
      new Map(),
      projection,
    );
    expect(layout.formFactor).toBe("narrow");
    view.attach(camera, layout, viewport);
    const first = layout.buildings[0]!;
    expect(camera.z).toBe(camera.limits!.home);
    const top = viewport.inset.top;
    const bottom = viewport.height - viewport.inset.bottom;
    // The center's plaque is on screen, centred on the buildings' axis.
    const plaque = townCenterEmblem(layout.center, T);
    const sign = camera.toScreen(plaque.x, plaque.y);
    expect(sign.y).toBeGreaterThan(top);
    expect(sign.x).toBeCloseTo(
      camera.toScreen((first.x + first.w / 2) * T, 0).x,
    );
    const flag = camera.toScreen(0, layout.center.y * T - 40).y;
    const lounge = camera.toScreen(0, (first.y + first.h + TOWN_FACADE) * T).y;
    expect(flag).toBeLessThanOrEqual(top + 0.01);
    if (framed === "flag") expect(flag).toBeCloseTo(top);
    if (framed === "lounge") expect(lounge).toBeCloseTo(bottom);
    if (framed === "plaque") {
      expect(camera.toScreen(0, plaque.y - 28).y).toBeCloseTo(top);
      expect(lounge).toBeGreaterThan(bottom);
    } else expect(lounge).toBeLessThanOrEqual(bottom + 0.01);
    // The reception board stands in the yard above the building, on screen.
    const board = camera.toScreen(0, (first.y - TOWN_PHONE_BOARD_ROWS) * T).y;
    expect(board).toBeGreaterThan(sign.y);
    expect(board).toBeLessThan(bottom);
    expect(view.atHome()).toBe(true);
  }
});

test("each town shape keeps its own camera across visits", () => {
  const poses = new Map<string, TownPose>();
  const first = setup(WIDE, poses);
  first.view.attach(first.camera, first.layout, first.viewport);
  expect(first.view.key("ArrowLeft")).toBe(true);
  first.camera.update(1 / 60);
  first.view.drew(first.camera, "overview", first.layout);
  const kept = { x: first.camera.x, y: first.camera.y, z: first.camera.z };
  expect(poses.get(townShapeKey(first.layout.shape))).toEqual({
    ...kept,
    home: false,
  });
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
  // Below the saved precision (a tenth of a pixel) a pan moves the drawn
  // camera but not the pose: it steps toward the middle of its tenth.
  camera.x += (camera.x * 10 + 0.5) % 1 < 0.5 ? 0.01 : -0.01;
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
  const from = { x: camera.x, y: camera.y };
  view.follow(grown, viewport);
  expect(reasons).toEqual(["reflow"]);
  // The camera glides with the room rather than jumping.
  expect([camera.x, camera.y]).toEqual([from.x, from.y]);
  expect(camera.moving).toBe(true);
  settle(camera);
  const after = camera.toScreen((moved.x + 1) * T, (moved.y + 1) * T);
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
});

test("a host hidden beside the viewed room keeps the room in place, never jumping", () => {
  // Three hosts with one eight-desk room each; look closely at the rightmost
  // room, then hide the middle host: the town shrinks under the camera.
  const three = townOf({
    a: { desks: working(8) },
    b: { desks: working(8) },
    c: { desks: working(8) },
  });
  const { view, layout, viewport, camera } = setup(WIDE, new Map(), three);
  view.attach(camera, layout, viewport);
  view.follow(layout, viewport);
  const room = layout.buildings[2]!.rooms[0]!;
  camera.jumpTo((room.x + room.w / 2) * T, (room.y + room.h / 2) * T, 2);
  const before = camera.toScreen((room.x + 1) * T, (room.y + 1) * T);
  const from = { x: camera.x, y: camera.y };
  const two = layoutFor(
    townOf({ a: { desks: working(8) }, c: { desks: working(8) } }),
    WIDE,
  );
  const moved = two.buildings[1]!.rooms[0]!;
  expect(moved.key).toBe(room.key);
  expect(moved.x).toBeLessThan(room.x);
  // The old position lies outside the smaller town.
  expect(from.x).toBeGreaterThan(two.width * T);
  view.follow(two, viewport);
  // The camera stays where it was drawn, then glides with the room.
  expect([camera.x, camera.y]).toEqual([from.x, from.y]);
  let worst = 0;
  for (let frame = 0; frame < 60 && camera.moving; frame += 1) {
    const prev = camera.x;
    camera.update(1 / 60);
    worst = Math.max(worst, Math.abs(camera.x - prev) * camera.z);
  }
  // No frame steps more than an eased glide's share.
  expect(worst).toBeLessThan(Math.abs(from.x - camera.x) * camera.z * 0.2);
  const after = camera.toScreen((moved.x + 1) * T, (moved.y + 1) * T);
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

test("a town viewed whole is framed again when it grows, then fits a narrower view", () => {
  const { view, layout, viewport, camera } = setup();
  view.attach(camera, layout, viewport);
  view.follow(layout, viewport);
  expect(view.atHome()).toBe(true);
  const grown = layoutFor(
    office({
      alpha: working(24),
      beta: working(3),
      gamma: working(2),
      delta: working(4),
    }),
    WIDE,
  );
  view.follow(grown, viewport);
  // It flies to the new home framing with the buildings, and is home there.
  expect(camera.flying).toBe(true);
  settle(camera);
  expect(view.atHome()).toBe(true);
  // A change while it flies frames the newest town.
  const shrunk = layoutFor(
    office({ alpha: working(2), beta: working(3) }),
    WIDE,
  );
  view.follow(shrunk, viewport);
  camera.update(0.05);
  view.follow(grown, viewport);
  settle(camera);
  expect(view.atHome()).toBe(true);
  // Opening a panel narrows the view; the home view fits the town again, so
  // every building stays on screen.
  const narrower = townViewport(1100, WIDE.height, NO_CHROME);
  view.reframe(grown, narrower, (next) => camera.configure(grown, next));
  for (const building of grown.buildings) {
    const left = camera.toScreen(building.x * 16, building.y * 16);
    const right = camera.toScreen(
      (building.x + building.w) * 16,
      (building.y + building.h) * 16,
    );
    expect(left.x).toBeGreaterThanOrEqual(0);
    expect(right.x).toBeLessThanOrEqual(1100);
  }
});

test("a saved home view is framed again for the view it returns to", () => {
  const poses = new Map<string, TownPose>();
  const first = setup(WIDE, poses);
  first.view.attach(first.camera, first.layout, first.viewport);
  first.view.drew(first.camera, "overview", first.layout);
  expect(poses.get(townShapeKey(first.layout.shape))?.home).toBe(true);
  // A later visit to a narrower view of the same shape fits the town to it.
  const narrower = { width: 1240, height: WIDE.height };
  const again = setup(narrower, poses);
  again.view.attach(again.camera, again.layout, again.viewport);
  expect(again.view.atHome()).toBe(true);
  expect(again.camera.z).toBe(again.camera.limits!.home);
});
