import { expect, test } from "bun:test";
import { deskAnchor, resolveOfficeLayout } from "./officeGeometry";
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
  expect(layout.rooms[0]!.deskRows).toBe(25);
  expect(layout.rooms[0]!.standingRows).toBe(5);
  expect(deskAnchor(layout.rooms[0]!, 99).row).toBe(24);
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

test("phone Office stacks attention receptions, Economy, Workforce and rooms within its width", () => {
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
  expect(layout.workforceRect!.y).toBeGreaterThan(
    layout.expenseRect!.y + layout.expenseRect!.height,
  );
  expect(layout.rooms[0]!.deskColumns).toBe(2);
  expect(layout.rooms[0]!.deskRows).toBe(6);
  expect(layout.rooms[1]!.y).toBeGreaterThan(
    layout.rooms[0]!.y + layout.rooms[0]!.height,
  );
  for (const room of layout.rooms)
    expect(room.x + room.width).toBeLessThanOrEqual(390);
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
    expect(layout.workforceRect!.y).toBeGreaterThan(
      layout.expenseRect!.y + layout.expenseRect!.height,
    );
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
