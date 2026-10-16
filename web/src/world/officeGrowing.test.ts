import { expect, test } from "bun:test";
import {
  deskAnchor,
  resolveOfficeLayout,
  OFFICE_GEOMETRY,
} from "./officeGeometry";
import {
  officePackedRoomCorridors,
  packOfficeRooms,
  officeRoomScrollOffset,
} from "./officeRoomPacking";
import { resolveOfficeSceneGeometry } from "./officeSceneLayout";
import { OfficeLayoutPublisher, officeGeometryDigest } from "./officeLayout";
import {
  officeDeskRange,
  officeVisibleReceptions,
} from "./officeVirtualization";

test("Office geometry keeps its existing 64-bit FNV digest format", () => {
  expect(officeGeometryDigest("")).toBe("office-v1-cbf29ce484222325");
  expect(officeGeometryDigest("hello")).toBe("office-v1-a430d84680aabd0b");
});

test("logical Office rooms grow past eight desks and the old room total", () => {
  const layout = resolveOfficeLayout(
    1200,
    Array.from({ length: 129 }, (_, sourceIndex) => ({
      sourceIndex,
      deskCount: sourceIndex === 0 ? 100 : 1,
      standingCount: sourceIndex === 0 ? 40 : 0,
    })),
    "left",
    undefined,
    7,
    undefined,
    { complete: true },
  );
  expect(layout.rooms).toHaveLength(129);
  expect(layout.rooms[0]!.deskRows).toBe(
    Math.ceil(100 / layout.rooms[0]!.deskColumns),
  );
  expect(layout.rooms[0]!.standingRows).toBe(
    Math.ceil(40 / layout.rooms[0]!.standingColumns),
  );
  expect(deskAnchor(layout.rooms[0]!, 99).row).toBe(
    layout.rooms[0]!.deskRows - 1,
  );
  expect(layout.ceoBlocks.receptions).toHaveLength(7);
  expect(layout.totalHeight).toBeGreaterThan(layout.rooms[128]!.y);
});

test("large-room viewport admission reaches late rows without renumbering desks", () => {
  const room = resolveOfficeLayout(
    390,
    [{ deskCount: 10_000, standingCount: 0 }],
    "left",
    undefined,
    0,
    undefined,
    { complete: true, compact: true },
  ).rooms[0]!;
  const anchor = deskAnchor(room, 9999);
  const [first, last] = officeDeskRange(room, 10_000, {
    x: 0,
    y: anchor.nameY - 300,
    width: 390,
    height: 600,
  });
  expect(first).toBeGreaterThan(9900);
  expect(last).toBe(10_000);
  expect(last - first).toBeLessThan(20);
});

test("published growing geometry keeps all room identities and collapses presentation only", () => {
  const input = {
    availableViewportWidth: 390,
    availableViewportHeight: 700,
    titleMode: "expand" as const,
    roomAlignment: "left" as const,
    ceoReceptionCount: 7,
    rooms: Array.from({ length: 129 }, (_, i) => ({
      id: `room-${i}`,
      title: `Room ${i}`,
      deskCount: i === 0 ? 100 : 1,
      standingCount: 0,
    })),
  };
  const expanded = resolveOfficeSceneGeometry(input);
  const collapsed = resolveOfficeSceneGeometry(input, new Set([0]));
  expect(expanded.layout.rooms).toHaveLength(129);
  expect(expanded.omissions).toEqual([]);
  expect(collapsed.normalizedInput.rooms[0]!.deskCount).toBe(100);
  expect(collapsed.layout.rooms[0]!.collapsed).toBe(true);
  expect(collapsed.layout.rooms[1]!.y).toBeLessThan(
    expanded.layout.rooms[1]!.y,
  );
  expect(officeDeskRange(collapsed.layout.rooms[0]!, 100)).toEqual([0, 0]);
});

test("phone reception paint admission follows its vertical viewport", () => {
  const layout = resolveOfficeLayout(
    390,
    [],
    "left",
    undefined,
    100,
    undefined,
    { complete: true, compact: true },
  );
  const receptions = Array.from({ length: 100 }, (_, i) => ({
    key: `r-${i}`,
    hostKey: `h-${i}`,
    hostLabel: `Host ${i}`,
    stale: false,
    waitingAgents: [],
    observedWaitingAgentCount: 0,
    overflowCount: 0,
  }));
  const visible = officeVisibleReceptions(
    receptions,
    layout.ceoBlocks.receptions,
    0,
    390,
    { y: 50 * 188, height: 700 },
  );
  expect(visible.some((entry) => entry.index === 50)).toBe(true);
  expect(visible.length).toBeLessThan(15);
  expect(visible.every((entry) => entry.index > 40)).toBe(true);
});

test("phone Office stacks attention receptions and rooms around fluid summary boards", () => {
  const layout = resolveOfficeLayout(
    390,
    [
      { deskCount: 12, standingCount: 0 },
      { deskCount: 1, standingCount: 0 },
    ],
    "left",
    undefined,
    7,
    undefined,
    { complete: true, compact: true },
  );
  expect(layout.officeWidth).toBe(390);
  expect(layout.ceoBlocks.receptions).toHaveLength(7);
  const receptions = layout.ceoBlocks.receptions;
  for (let index = 1; index < receptions.length; index++) {
    expect(receptions[index]!.y).toBeGreaterThanOrEqual(
      receptions[index - 1]!.y + receptions[index - 1]!.height,
    );
  }
  expect(layout.expenseRect!.y).toBeGreaterThanOrEqual(
    receptions[6]!.y + receptions[6]!.height,
  );
  expect(layout.rooms[0]!.y).toBeGreaterThan(
    layout.workforceRect!.y + layout.workforceRect!.height,
  );
  expect(layout.workforceRect!.y).toBe(layout.expenseRect!.y);
  expect(layout.workforceRect!.x).toBeGreaterThanOrEqual(
    layout.expenseRect!.x + layout.expenseRect!.width,
  );
  expect(layout.rooms[0]!.deskColumns).toBe(2);
  expect(layout.rooms[0]!.deskRows).toBe(6);
  expect(layout.rooms[1]!.y).toBeGreaterThan(
    layout.rooms[0]!.y + layout.rooms[0]!.height,
  );
  for (const room of layout.rooms)
    expect(room.x + room.width).toBeLessThanOrEqual(390);
});

test("phone summary boards share available width and wrap only below readable content bounds", () => {
  for (const width of [240, 320, 360, 375, 390, 430, 600, 720]) {
    const layout = resolveOfficeLayout(
      width,
      [],
      "left",
      undefined,
      0,
      undefined,
      { complete: true, compact: true, attentionReceptionIndices: [] },
    );
    const economy = layout.expenseRect!,
      workforce = layout.workforceRect!;
    if (width >= 380) {
      expect(workforce.y).toBe(economy.y);
      expect(workforce.x).toBe(economy.x + economy.width + 12);
      expect(workforce.x + workforce.width).toBeCloseTo(width - 12);
    } else {
      expect(workforce.y).toBe(economy.y + economy.height + 12);
      expect(economy.width).toBe(width - 24);
      expect(workforce.width).toBe(economy.width);
    }
    for (const board of [economy, workforce]) {
      expect(board.width - 4).toBeGreaterThanOrEqual(
        OFFICE_GEOMETRY.compactBoardMinWidth,
      );
      expect(board.x + board.width).toBeLessThanOrEqual(width - 12);
      expect(board.y + board.height).toBeLessThanOrEqual(layout.ceoBandHeight);
    }
    expect(layout.ceoBandHeight).toBe(workforce.y + workforce.height + 12);
  }
});

test("large Office publication yields and fences superseded geometry without mutating inputs", async () => {
  const geometry = resolveOfficeSceneGeometry({
    availableViewportWidth: 390,
    availableViewportHeight: 700,
    titleMode: "expand",
    roomAlignment: "left",
    rooms: Array.from({ length: 129 }, (_, index) => ({
      id: `room-${index}`,
      title: `Room ${index}`,
      deskCount: 100,
      standingCount: 20,
    })),
  });
  const publisher = new OfficeLayoutPublisher();
  let yields = 0;
  const published = await publisher.publishAsync(
    { canonicalDigest: geometry.inputDigest },
    geometry,
    () => true,
    async () => {
      yields++;
    },
  );
  expect(yields).toBeGreaterThan(1);
  expect(published!.rooms).toHaveLength(129);
  expect(published).toEqual(
    new OfficeLayoutPublisher().publish(
      { canonicalDigest: geometry.inputDigest },
      geometry,
    ),
  );
  expect(Object.isFrozen(published!.rooms[0]!.outerRect)).toBe(true);
  expect(Object.isFrozen(geometry.layout.rooms[0]!.outerRect)).toBe(false);
  expect(publisher.isCanvasReady(published!.layoutRevision)).toBe(false);
  expect(publisher.ackCanvasRendered(published!.layoutRevision)).toBe(true);
  const replacement = { ...geometry, inputDigest: "replacement" };
  const held = Promise.withResolvers<void>();
  const reached = Promise.withResolvers<void>();
  const stale = publisher.publishAsync(
    { canonicalDigest: "replacement" },
    replacement,
    () => true,
    () => {
      reached.resolve();
      return held.promise;
    },
  );
  await reached.promise;
  const retained = publisher.publish(
    { canonicalDigest: geometry.inputDigest },
    geometry,
  );
  held.resolve();
  expect(await stale).toBeNull();
  expect(retained).toBe(published!);
  expect(publisher.isCanvasReady(published!.layoutRevision)).toBe(true);
});

test("phone hides empty receptions and keeps qualified attention above Economy and Workforce", () => {
  for (const attentionReceptionIndices of [[1], []]) {
    const layout = resolveOfficeSceneGeometry({
      availableViewportWidth: 390,
      availableViewportHeight: 700,
      titleMode: "expand",
      roomAlignment: "left",
      ceoReceptionCount: 3,
      attentionReceptionIndices,
      rooms: [
        { id: "room", title: "Workspace", deskCount: 1, standingCount: 0 },
      ],
    }).layout;
    const receptions = layout.ceoBlocks.receptions;
    expect(receptions.map((rect) => rect.index)).toEqual([0, 1, 2]);
    expect(layout.workforceRect!.y).toBe(layout.expenseRect!.y);
    expect(
      receptions.filter((rect) => rect.width > 0).map((rect) => rect.index),
    ).toEqual(attentionReceptionIndices);
    if (attentionReceptionIndices.length)
      expect(receptions[1]!.y + receptions[1]!.height).toBeLessThan(
        layout.expenseRect!.y,
      );
    else expect(layout.expenseRect!.y).toBe(12);
    expect(layout.rooms[0]!.y).toBeGreaterThan(
      layout.workforceRect!.y + layout.workforceRect!.height,
    );
    const projected = receptions.map((_, index) => ({
      key: `r-${index}`,
      hostKey: `h-${index}`,
      hostLabel: `Host ${index}`,
      stale: false,
      waitingAgents: [],
      observedWaitingAgentCount: attentionReceptionIndices.includes(index)
        ? 1
        : 0,
      overflowCount: 0,
    }));
    expect(
      officeVisibleReceptions(projected, receptions, 0, 390, {
        y: 0,
        height: 700,
      }).map((item) => item.index),
    ).toEqual(attentionReceptionIndices);
  }
});

test("wide desktop adapts desk columns and stacks small rooms beside a large room", () => {
  const rooms = [
    { deskCount: 100, standingCount: 0 },
    ...Array.from({ length: 130 }, () => ({ deskCount: 2, standingCount: 0 })),
  ];
  const resolve = (width: number) =>
    resolveOfficeLayout(width, rooms, "left", undefined, 3, undefined, {
      complete: true,
    });
  const wide = resolve(3440);
  const narrow = resolve(1280);
  const large = wide.rooms[0]!;
  expect(large.deskColumns).toBeGreaterThan(4);
  expect(large.deskColumns).toBeGreaterThan(narrow.rooms[0]!.deskColumns);
  expect(large.height).toBeLessThan(narrow.rooms[0]!.height);
  const beside = wide.rooms
    .slice(1)
    .filter(
      (room) =>
        room.x >= large.x + large.width && room.y < large.y + large.height,
    );
  expect(new Set(beside.map((room) => room.y)).size).toBeGreaterThan(2);
  expect(wide.totalHeight).toBeLessThan(narrow.totalHeight);
  expect(wide).toEqual(resolve(3440));
});

test("fluid desktop preserves readable nonoverlapping rooms across widths and alignment", () => {
  for (const width of [1024, 1440, 3440])
    for (const alignment of ["left", "center", "right"] as const) {
      const layout = resolveOfficeLayout(
        width,
        [100, 1, 12, 2, 80, 4, 30, 1, 1, 2, 3, 1].map((deskCount) => ({
          deskCount,
          standingCount: 0,
        })),
        alignment,
        undefined,
        2,
        undefined,
        { complete: true },
      );
      expect(layout.rooms.map((room) => room.index)).toEqual(
        Array.from({ length: 12 }, (_, index) => index),
      );
      for (const room of layout.rooms) {
        expect(room.x).toBeGreaterThanOrEqual(12);
        expect(room.x + room.width).toBeLessThanOrEqual(width - 12);
        expect(deskAnchor(room, 0).stationSpan).toBeGreaterThanOrEqual(112);
        expect(layout.totalHeight).toBeGreaterThan(room.y + room.height);
        for (const other of layout.rooms)
          if (other.index !== room.index) {
            expect(
              room.x + room.width <= other.x ||
                other.x + other.width <= room.x ||
                room.y + room.height <= other.y ||
                other.y + other.height <= room.y,
            ).toBe(true);
          }
      }
    }
});

test("packed room corridors stay clear of every unequal neighboring room", () => {
  for (const width of [1024, 1440, 3440]) {
    const layout = resolveOfficeLayout(
      width,
      [100, 1, 12, 2, 80, 4, 30, 1, 1, 2, 3, 1].map((deskCount) => ({
        deskCount,
        standingCount: 0,
      })),
      "center",
      undefined,
      1,
      undefined,
      { complete: true },
    );
    for (const room of layout.rooms)
      for (const corridor of Object.values(
        officePackedRoomCorridors(
          room,
          width - 12,
          OFFICE_GEOMETRY.roomGap,
          OFFICE_GEOMETRY.roomRowGap,
        ),
      )) {
        for (const other of layout.rooms)
          expect(
            corridor.width === 0 ||
              corridor.x + corridor.width <= other.x ||
              other.x + other.width <= corridor.x ||
              corridor.y + corridor.height <= other.y ||
              other.y + other.height <= corridor.y,
          ).toBe(true);
      }
  }
});

test("fluid standing rooms grow across the screen and responsive rows retain their logical item", () => {
  const resolve = (width: number) =>
    resolveOfficeLayout(
      width,
      [
        { deskCount: 100, standingCount: 0 },
        { deskCount: 0, standingCount: 200 },
      ],
      "left",
      undefined,
      1,
      undefined,
      { complete: true },
    );
  const narrow = resolve(1024);
  const wide = resolve(3440);
  expect(wide.rooms[1]!.standingColumns).toBeGreaterThan(
    narrow.rooms[1]!.standingColumns,
  );
  const before = narrow.rooms[0]!;
  const after = wide.rooms[0]!;
  const offset = 56 + 10 * before.deskRowHeight + 7;
  expect(officeRoomScrollOffset(before, after, offset)).toBe(
    56 +
      Math.floor((10 * before.deskColumns) / after.deskColumns) *
        after.deskRowHeight +
      7,
  );
});

test("packing retains cavities beneath a bridging rectangle for later rooms", () => {
  const packed = packOfficeRooms(
    [
      { width: 300, height: 300 },
      { width: 200, height: 100 },
      { width: 400, height: 100 },
      { width: 100, height: 200 },
      { width: 100, height: 200 },
    ],
    500,
    0,
    0,
  );
  expect(
    Math.max(...packed.map((room) => room.y + room.height)),
  ).toBeLessThanOrEqual(400);
  expect(packed[4]!.y).toBeLessThan(packed[2]!.y);
});
