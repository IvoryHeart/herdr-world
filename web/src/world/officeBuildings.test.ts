import { expect, test } from "bun:test";
import {
  resolveOfficeSceneGeometry,
  resolveOfficeSceneGeometryAsync,
} from "./officeSceneLayout";
import { officeVisibleRooms } from "./officeVirtualization";

function input(width: number, collapsed = false) {
  return {
    availableViewportWidth: width,
    availableViewportHeight: 800,
    titleMode: "expand" as const,
    roomAlignment: "left" as const,
    rooms: [100, 1, 1, 1, 1].map((deskCount, index) => ({
      id: `host-${index < 4 ? "a" : "b"}/room-${index}`,
      title: `Room ${index}`,
      hostTitle: "Equal label",
      deskCount,
      standingCount: 0,
    })),
    buildings: [
      {
        key: "host-a",
        title: "Equal label",
        state: "ready",
        stale: false,
        roomIndices: [0, 1, 2, 3],
        agentCount: 103,
        attentionCount: 2,
        collapsed,
      },
      {
        key: "host-b",
        title: "Equal label",
        state: "error",
        stale: true,
        roomIndices: [4],
        agentCount: 1,
        attentionCount: 1,
        collapsed: false,
      },
    ],
  };
}

test("qualified host buildings pack side by side on desktop and stack on phones", () => {
  for (const width of [390, 1440, 3440]) {
    const geometry = resolveOfficeSceneGeometry(input(width));
    const layout = geometry.layout;
    const [a, b] = layout.buildings!;
    expect(a!.key).not.toBe(b!.key);
    expect(a!.title).toBe(b!.title);
    expect(geometry.normalizedInput.rooms.map((room) => room.id)).toEqual(
      input(width).rooms.map((room) => room.id),
    );
    if (width === 390)
      expect(b!.rect.y).toBeGreaterThan(a!.rect.y + a!.rect.height);
    else {
      expect(b!.rect.x).toBeGreaterThan(a!.rect.x + a!.rect.width);
      expect(b!.rect.y).toBe(a!.rect.y);
    }
    for (const building of layout.buildings!) {
      expect(building.headerRect.height).toBeGreaterThanOrEqual(48);
      expect(building.headerRect.y).toBeGreaterThan(building.rect.y);
      for (const index of building.roomIndices) {
        const room = layout.rooms[index]!;
        expect(room.x).toBeGreaterThan(building.rect.x);
        expect(room.y).toBeGreaterThan(
          building.headerRect.y + building.headerRect.height,
        );
        expect(room.x + room.width).toBeLessThan(
          building.rect.x + building.rect.width,
        );
        expect(room.y + room.height).toBeLessThan(
          building.rect.y + building.rect.height,
        );
      }
    }
  }
});

test("host collapse hides only its own rooms and preserves room collapse and observed counts", () => {
  const minimizedRooms = new Set([1]);
  const collapsed = resolveOfficeSceneGeometry(
    input(3440, true),
    minimizedRooms,
  );
  const expanded = resolveOfficeSceneGeometry(input(3440), minimizedRooms);
  expect(collapsed.layout.buildings![0]).toMatchObject({
    key: "host-a",
    collapsed: true,
    agentCount: 103,
    attentionCount: 2,
    roomIndices: [0, 1, 2, 3],
  });
  expect(
    collapsed.layout.rooms.slice(0, 4).every((room) => room.hiddenByHost),
  ).toBe(true);
  expect(collapsed.layout.rooms[4]!.hiddenByHost).not.toBe(true);
  expect(
    officeVisibleRooms(collapsed.layout.rooms, 0, 100000).map(
      (room) => room.index,
    ),
  ).toEqual([4]);
  expect(expanded.layout.rooms[1]!.collapsed).toBe(true);
  expect(expanded.layout.rooms[0]!.collapsed).not.toBe(true);
  expect(expanded.normalizedInput.rooms[0]!.deskCount).toBe(100);
  expect(expanded.layout.buildings![0]!.rect.height).toBeGreaterThan(
    collapsed.layout.buildings![0]!.rect.height,
  );
});

test("host layout preparation yields and cancels before publishing a retired request", async () => {
  let current = true;
  let yields = 0;
  const retired = await resolveOfficeSceneGeometryAsync(
    input(3440),
    new Set(),
    () => current,
    async () => {
      yields++;
      current = false;
    },
  );
  expect(yields).toBe(1);
  expect(retired).toBeNull();
  const complete = await resolveOfficeSceneGeometryAsync(
    input(3440),
    new Set(),
    () => true,
    async () => {
      yields++;
    },
  );
  expect(complete).toEqual(resolveOfficeSceneGeometry(input(3440)));
  expect(yields).toBeGreaterThan(2);
});
