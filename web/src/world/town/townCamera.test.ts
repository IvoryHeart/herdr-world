import { expect, test } from "bun:test";
import {
  TownCamera,
  townLevel,
  townRoomFocus,
  townZoomLimits,
} from "./townCamera";
import { layoutTown } from "./townLayout";

const input = {
  hosts: ["a", "b", "c"].map((key, displayOrder) => ({ key, displayOrder })),
  rooms: ["a", "b", "c"].flatMap((hostKey) =>
    Array.from({ length: 8 }, (_, order) => ({
      key: `${hostKey}/${order}`,
      hostKey,
      order,
      deskKeys: Array.from(
        { length: 12 },
        (_, i) => `${hostKey}/${order}/${i}`,
      ),
    })),
  ),
};
const desktop = {
  width: 1440,
  height: 900,
  inset: { top: 70, right: 0, bottom: 20, left: 240 },
};
const phone = {
  width: 390,
  height: 844,
  inset: { top: 70, right: 0, bottom: 90, left: 0 },
};

test("desktop default fits every building at the overview level", () => {
  const { layout } = layoutTown(input, "wide");
  const limits = townZoomLimits(layout, desktop);
  expect(townLevel(limits.home, limits)).toBe("overview");
  const camera = new TownCamera();
  camera.configure(layout, desktop);
  camera.jumpTo((layout.width * 16) / 2, (layout.height * 16) / 2, limits.home);
  for (const building of layout.buildings) {
    const topLeft = camera.toScreen(building.x * 16, building.y * 16);
    const bottomRight = camera.toScreen(
      (building.x + building.w) * 16,
      (building.y + building.h) * 16,
    );
    expect(topLeft.x).toBeGreaterThanOrEqual(desktop.inset.left - 1);
    expect(bottomRight.x).toBeLessThanOrEqual(desktop.width + 1);
    expect(topLeft.y).toBeGreaterThanOrEqual(desktop.inset.top - 1);
    expect(bottomRight.y).toBeLessThanOrEqual(
      desktop.height - desktop.inset.bottom + 1,
    );
  }
});

test("phone default fits the first building's width at the overview level", () => {
  const { layout } = layoutTown(input, "narrow");
  const limits = townZoomLimits(layout, phone);
  expect(townLevel(limits.home, limits)).toBe("overview");
  expect((layout.buildings[0]!.w + 2) * 16 * limits.home).toBeLessThanOrEqual(
    phone.width,
  );
});

test("zooming out past the default reaches the town level and zooming in reaches desks", () => {
  const { layout } = layoutTown(input, "wide");
  const limits = townZoomLimits(layout, desktop);
  expect(townLevel(limits.min, limits)).toBe("town");
  expect(townLevel(limits.max, limits)).toBe("desk");
  expect(limits.min).toBeLessThan(limits.roof);
  expect(limits.roof).toBeLessThan(limits.card);
  expect(limits.card).toBeLessThan(limits.desk);
});

test("zooming about a point keeps that world point under the pointer", () => {
  const { layout } = layoutTown(input, "wide");
  const camera = new TownCamera();
  camera.configure(layout, desktop);
  camera.jumpTo(800, 600, 1);
  const before = camera.toWorld(300, 400);
  camera.zoomAt(2, 300, 400, false);
  const after = camera.toWorld(300, 400);
  expect(after.x).toBeCloseTo(before.x, 5);
  expect(after.y).toBeCloseTo(before.y, 5);
});

test("a flight ends exactly on its target and reduced motion jumps", () => {
  const { layout } = layoutTown(input, "wide");
  const camera = new TownCamera();
  camera.configure(layout, desktop);
  camera.jumpTo(100, 100, 0.5);
  camera.flyTo(1500, 900, 2, 0.5);
  for (let i = 0; i < 200 && camera.flying; i += 1) camera.update(1 / 60);
  expect(camera.flying).toBe(false);
  const focus = camera.focusPoint();
  const world = camera.toWorld(focus.x, focus.y);
  expect(world.x).toBeCloseTo(1500, 3);
  expect(world.y).toBeCloseTo(900, 3);
  expect(camera.z).toBeCloseTo(2, 5);
  camera.reducedMotion = true;
  camera.flyTo(200, 300, 1);
  expect(camera.flying).toBe(false);
});

test("a town with too many rooms for cards opens at roof level", () => {
  const hosts = Array.from({ length: 12 }, (_, index) => `host-${index}`);
  const large = {
    hosts: hosts.map((key, displayOrder) => ({ key, displayOrder })),
    rooms: hosts.flatMap((hostKey) =>
      Array.from({ length: 6 }, (_, order) => ({
        key: `${hostKey}/${order}`,
        hostKey,
        order,
        deskKeys: [`${hostKey}/${order}/0`],
      })),
    ),
  };
  const limits = townZoomLimits(layoutTown(large, "wide").layout, desktop);
  expect(townLevel(limits.home, limits)).toBe("town");
  expect(townLevel(limits.card, limits)).toBe("room");
  expect(limits.roof).toBeLessThan(limits.card);
  expect(limits.min).toBeLessThan(limits.home);
});

test("a room that fits is centred; an extended room opens at its first desks", () => {
  const view = {
    width: 390,
    height: 800,
    inset: { top: 60, right: 0, bottom: 100, left: 0 },
  };
  const small = { x: 10, y: 10, w: 16, h: 11 };
  expect(townRoomFocus(small, view, 1)).toEqual({
    x: (10 + 8) * 16,
    y: (10 + 5.5) * 16,
  });
  // 8 desks wide and 16 deep: neither fits at this zoom, so the room's
  // top-left corner sits at the usable view's top-left.
  const tall = { x: 10, y: 10, w: 41, h: 81 };
  const z = 0.9;
  const focus = townRoomFocus(tall, view, z);
  expect(focus.x - view.width / 2 / z).toBeCloseTo(10 * 16 - 20);
  expect(focus.y - (view.height / 2 - view.inset.top) / z).toBeCloseTo(
    10 * 16 - 24,
  );
});
