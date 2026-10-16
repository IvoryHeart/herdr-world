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

test("wide Office distributes usable width across occupied buildings and reduces their depth", () => {
  const fixture = (width: number) => ({
    availableViewportWidth: width,
    availableViewportHeight: 1000,
    titleMode: "expand" as const,
    roomAlignment: "left" as const,
    rooms: Array.from({ length: 14 }, (_, index) => ({
      id: `host-${Math.floor(index / 7)}/workspace-${index % 7}`,
      title: `Workspace ${index % 7}`,
      deskCount: [9, 8, 7, 6, 5, 4, 3][index % 7]!,
      standingCount: 0,
    })),
    buildings: [0, 1].map((index) => ({
      key: `host-${index}`,
      title: "Equal host label",
      state: "ready",
      stale: false,
      roomIndices: Array.from({ length: 7 }, (_, room) => index * 7 + room),
      agentCount: 42,
      attentionCount: 0,
      collapsed: false,
    })),
  });
  const narrow = resolveOfficeSceneGeometry(fixture(1440)).layout;
  const wide = resolveOfficeSceneGeometry(fixture(3440)).layout;
  const right = Math.max(
    ...wide.buildings!.map(({ rect }) => rect.x + rect.width),
  );
  expect(right).toBeGreaterThanOrEqual(wide.officeWidth - 14);
  expect(wide.buildings![1]!.rect.y).toBe(wide.buildings![0]!.rect.y);
  expect(wide.totalHeight - wide.roomStartY).toBeLessThan(
    (narrow.totalHeight - narrow.roomStartY) * 0.8,
  );
  for (const group of wide.buildings!) {
    const rooms = group.roomIndices.map((index) => wide.rooms[index]!);
    expect(new Set(rooms.map((room) => room.x)).size).toBeGreaterThanOrEqual(3);
    for (const room of rooms) {
      expect(room.x).toBeGreaterThan(group.rect.x);
      expect(room.x + room.width).toBeLessThan(group.rect.x + group.rect.width);
      for (const other of rooms)
        if (room.index !== other.index)
          expect(
            room.x + room.width <= other.x ||
              other.x + other.width <= room.x ||
              room.y + room.height <= other.y ||
              other.y + other.height <= room.y,
          ).toBe(true);
    }
  }
});

test("a single large workspace uses wide building space to reduce desk rows", () => {
  const fixture = (width: number) => ({
    availableViewportWidth: width,
    availableViewportHeight: 1000,
    titleMode: "expand" as const,
    roomAlignment: "left" as const,
    rooms: [
      {
        id: "host-a/large",
        title: "Large workspace",
        deskCount: 100,
        standingCount: 0,
      },
    ],
    buildings: [
      {
        key: "host-a",
        title: "Host A",
        state: "ready",
        stale: false,
        roomIndices: [0],
        agentCount: 100,
        attentionCount: 0,
        collapsed: false,
      },
    ],
  });
  const narrow = resolveOfficeSceneGeometry(fixture(1440)).layout;
  const wide = resolveOfficeSceneGeometry(fixture(3440)).layout;
  expect(wide.rooms[0]!.deskColumns).toBeGreaterThanOrEqual(20);
  expect(wide.rooms[0]!.deskRows).toBeLessThan(narrow.rooms[0]!.deskRows);
  expect(wide.rooms[0]!.x + wide.rooms[0]!.width).toBeLessThan(
    wide.buildings![0]!.rect.x + wide.buildings![0]!.rect.width,
  );
});

test("room shape and placement are chosen together to fill a narrow building", () => {
  const layout = resolveOfficeSceneGeometry({
    availableViewportWidth: 900,
    availableViewportHeight: 1000,
    titleMode: "expand",
    roomAlignment: "left",
    rooms: [4, 8, 5, 3, 3, 4].map((deskCount, index) => ({
      id: `host-a/room-${index}`,
      title: `R${index}`,
      hostTitle: "Host A",
      deskCount,
      standingCount: 0,
    })),
    buildings: [
      {
        key: "host-a",
        title: "Host A",
        state: "ready",
        stale: false,
        roomIndices: [0, 1, 2, 3, 4, 5],
        agentCount: 27,
        attentionCount: 0,
        collapsed: false,
      },
    ],
  }).layout;
  expect(layout.rooms[1]!.y).toBe(layout.rooms[0]!.y);
  expect(layout.buildings![0]!.rect.height).toBeLessThan(1100);
});
