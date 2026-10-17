import { describe, expect, test } from "bun:test";

const it = test;
import { OFFICE_GEOMETRY, resolveCeoBlockLayout } from "./officeGeometry";
import {
  OfficeLayoutPublisher,
  normalizeOfficeGeometryInput,
  resolveOfficeGeometry,
} from "./officeLayout";

function room(id = "room-1", overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: "work",
    deskCount: 1,
    standingCount: 0,
    title: "A very long workspace title haiku-4-5-2025",
    hostTitle: "anthropic-long-host-name",
    ...overrides,
  };
}

function contains(
  outer: { x: number; y: number; width: number; height: number },
  inner: typeof outer,
) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

describe("Office layout contract", () => {
  it("measures expanded and compact headers without letting labels escape the room cap", () => {
    const normal = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [room()],
    });
    const normalHeader = normal.roomHeaders[0]!;
    const normalRect = normal.layout.rooms[0];
    expect(normalHeader.emergencyEllipsis).toBe(false);
    expect(normalHeader.workspace).toContain("2025");
    expect(normalHeader.titleBoxWidth).toBeLessThan(normalHeader.width);
    expect(normalHeader.width).toBeGreaterThanOrEqual(
      normalHeader.titleBoxWidth +
        2 *
          (normalHeader.renameWidth +
            normalHeader.actionGap +
            normalHeader.closeWidth +
            normalHeader.closeGap) +
        OFFICE_GEOMETRY.roomHeaderSafeInset * 2,
    );
    expect(normalRect.width).toBeGreaterThanOrEqual(normalHeader.width);
    expect(normalRect.header?.titleBoxX).toBeGreaterThan(0);
    expect(normalRect.header?.titleBoxX).toBeCloseTo(
      (normalRect.headerRect.width - normalHeader.titleBoxWidth) / 2,
    );
    expect(
      normalRect.header!.renameX +
        normalHeader.renameWidth +
        normalHeader.closeGap,
    ).toBeLessThanOrEqual(normalRect.header!.closeX);
    expect(normalRect.header!.closeX + normalHeader.closeWidth).toBe(
      normalRect.headerRect.width,
    );

    const expanded = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      maximumExpandedRoomWidth: 300,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [room()],
    });
    const compact = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      maximumExpandedRoomWidth: 300,
      titleMode: "compact",
      roomAlignment: "left",
      rooms: [room()],
    });
    expect(expanded.roomHeaders[0]?.emergencyEllipsis).toBe(true);
    expect(expanded.roomHeaders[0]?.width).toBeLessThanOrEqual(300);
    expect(compact.roomHeaders[0]?.workspace).not.toContain("2025");
    expect(compact.roomHeaders[0]?.width).toBeLessThanOrEqual(300);

    const measured = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [room("measured", { headerMinTitleBoxWidth: 500 })],
    });
    expect(measured.roomHeaders[0]!.titleBoxWidth).toBeGreaterThanOrEqual(500);
  });

  it("makes the room wide enough for either the header group or a desk row", () => {
    const longHeader = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [room("long-header", { deskCount: 1 })],
    });
    const manyDesks = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [
        room("many-desks", {
          title: "ROOM",
          hostTitle: "HOST",
          deskCount: OFFICE_GEOMETRY.desksPerRoom,
        }),
      ],
    });
    const headerRect = longHeader.layout.rooms[0];
    const deskRect = manyDesks.layout.rooms[0];
    expect(headerRect.width).toBeGreaterThanOrEqual(
      longHeader.roomHeaders[0]!.width,
    );
    expect(deskRect.width).toBeGreaterThanOrEqual(
      OFFICE_GEOMETRY.roomPadding * 2 + deskRect.deskColumns * 112,
    );
    expect(deskRect.width).toBeGreaterThanOrEqual(
      manyDesks.roomHeaders[0]!.width,
    );
  });

  it("keeps nested visual bounds and wrapped CEO content finite", () => {
    const ceo = resolveCeoBlockLayout(OFFICE_GEOMETRY.minOfficeWidth, 6);
    expect(ceo.receptionRows).toBeGreaterThan(1);
    expect(ceo.ceoBandHeight).toBeGreaterThan(OFFICE_GEOMETRY.ceoBandHeight);
    expect(ceo.agentBarX + ceo.agentBarWidth).toBeLessThanOrEqual(
      OFFICE_GEOMETRY.minOfficeWidth - OFFICE_GEOMETRY.ceoEdgePadding,
    );

    const result = resolveOfficeGeometry({
      availableViewportWidth: OFFICE_GEOMETRY.minOfficeWidth,
      ceoReceptionCount: 6,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [room()],
    });
    const rect = result.layout.rooms[0];
    expect(rect).toBeDefined();
    expect(contains(rect.outerRect, rect.wallRect)).toBe(true);
    expect(contains(rect.outerRect, rect.headerRect)).toBe(true);
    expect(contains(rect.outerRect, rect.contentSafeRect)).toBe(true);
    expect(contains(rect.outerRect, rect.clipRect)).toBe(true);
    expect(contains(rect.clipRect, rect.inkBounds)).toBe(true);
    expect(rect.y).toBeGreaterThan(ceo.ceoBandHeight);
    expect(rect.x + rect.width).toBeLessThanOrEqual(result.layout.officeWidth);
  });

  it("publishes revisions only for canonical digest changes and gates stale canvas acknowledgements", () => {
    const publisher = new OfficeLayoutPublisher();
    const input = {
      availableViewportWidth: 1000,
      titleMode: "expand" as const,
      roomAlignment: "left" as const,
      rooms: [room()],
    };
    const first = resolveOfficeGeometry(input);
    const publishedA = publisher.publish(
      { canonicalDigest: first.inputDigest },
      first,
    );
    const same = publisher.publish(
      { canonicalDigest: first.inputDigest },
      first,
    );
    expect(same).toBe(publishedA);
    expect(publishedA.layoutRevision).toBe(1);
    expect(publisher.ackCanvasRendered(0)).toBe(false);
    expect(publisher.ackCanvasRendered(publishedA.layoutRevision)).toBe(true);
    expect(publisher.isCanvasReady(publishedA.layoutRevision)).toBe(true);

    const second = resolveOfficeGeometry({ ...input, roomAlignment: "center" });
    const publishedB = publisher.publish(
      { canonicalDigest: second.inputDigest },
      second,
    );
    expect(publishedB.layoutRevision).toBe(2);
    expect(publisher.ackCanvasRendered(publishedA.layoutRevision)).toBe(false);
    expect(publisher.ackCanvasRendered(publishedB.layoutRevision + 1)).toBe(
      false,
    );
    expect(publisher.canvasRenderedRevision).toBe(publishedA.layoutRevision);

    const backToA = publisher.publish(
      { canonicalDigest: first.inputDigest },
      first,
    );
    expect(backToA.layoutRevision).toBe(3);
    expect(() =>
      publisher.publish({ canonicalDigest: "wrong" }, first),
    ).toThrow(/does not match/);
  });

  it("publishes the complete immutable geometry snapshot", () => {
    const result = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [room("published")],
    });
    const published = new OfficeLayoutPublisher().publish(
      { canonicalDigest: result.inputDigest },
      result,
    );
    expect(published.generationId).toBe(result.inputDigest);
    expect(published.normalizedInput.minimumLogicalCanvasWidth).toBeDefined();
    expect(published.roomHeaders).toEqual(result.roomHeaders);
    expect([...published.rows]).toEqual([...result.rows]);
    expect(published.contentItems).toEqual(result.contentItems);
    expect(published.omissionSummary).toEqual(result.omissionSummary);
    expect(Object.isFrozen(published)).toBe(true);
    expect(Object.isFrozen(published.rooms)).toBe(true);
    expect(Object.isFrozen(published.rooms[0])).toBe(true);
    expect(Object.isFrozen(published.normalizedInput)).toBe(true);
    expect(Object.isFrozen(published.normalizedInput.rooms)).toBe(true);
    expect(
      Object.isFrozen(published.normalizedInput.rooms[0].contentItems),
    ).toBe(true);
    expect(Object.isFrozen(published.ceoBlocks)).toBe(true);
    expect(Object.isFrozen(published.ceoBlocks.receptions)).toBe(true);
  });

  it("uses a stable digest for equivalent descriptor property order", () => {
    const firstRoom = {
      id: "same",
      title: "Same title",
      hostTitle: "Same host",
      deskCount: 1,
      standingCount: 0,
      contentItems: [],
      ignored: "not part of the contract",
    };
    const secondRoom = {
      contentItems: [],
      standingCount: 0,
      deskCount: 1,
      hostTitle: "Same host",
      title: "Same title",
      id: "same",
      ignored: { changed: true },
    };
    const first = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [firstRoom],
    });
    const second = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [secondRoom],
    });
    expect(second.inputDigest).toBe(first.inputDigest);
  });

  it("bounds omission samples while reporting aggregate required overflow", () => {
    const result = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      maxContentItems: 1,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [
        room("bounded", {
          contentItems: Array.from({ length: 200 }, (_, index) => ({
            id: `item-${index}`,
            kind: "board",
            importance: "required" as const,
            order: index,
            minWidth: 40,
            minHeight: 20,
          })),
        }),
      ],
    });
    expect(result.omissionSummary.total).toBeGreaterThan(8);
    expect(
      result.omissionSummary.byReason["content-item-count-cap"],
    ).toBeGreaterThan(0);
    expect(
      result.omissionSummary.samples["content-item-count-cap"]?.length,
    ).toBeLessThanOrEqual(8);
    expect(result.accessibleOverflow).toEqual({
      label: "Some required Office content is not shown.",
      required: true,
    });
    expect(result.layout.overflowMarker ?? null).toEqual(
      result.accessibleOverflow,
    );
  });

  it("packs bounded synthetic CEO items into the CEO content region", () => {
    const result = resolveOfficeGeometry({
      availableViewportWidth: OFFICE_GEOMETRY.minOfficeWidth,
      ceoReceptionCount: 6,
      titleMode: "expand",
      roomAlignment: "left",
      ceoContentItems: Array.from({ length: 6 }, (_, index) => ({
        id: `ceo-board-${index}`,
        kind: "board",
        importance: "required" as const,
        order: index,
        minWidth: 220,
        minHeight: 48,
        preferredWidth: 220,
        preferredHeight: 48,
      })),
      rooms: [],
    });
    expect(
      result.contentItems.filter(({ roomIndex }) => roomIndex === -1),
    ).toHaveLength(6);
    expect(result.layout.ceoContentRect.width).toBeGreaterThan(0);
    expect(result.layout.ceoContentRect.height).toBeGreaterThan(0);
    expect(
      result.contentItems
        .filter(({ roomIndex }) => roomIndex === -1)
        .every(
          (item) =>
            contains(result.layout.ceoRect, item.clipRect) &&
            contains(item.clipRect, item.inkBounds),
        ),
    ).toBe(true);
  });

  it("accounts for every item beyond the bounded content cap", () => {
    const result = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      maxContentItems: 128,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [
        room("large-input", {
          contentItems: Array.from({ length: 3000 }, (_, index) => ({
            id: `large-${index}`,
            kind: "board",
            importance: "optional" as const,
            order: index,
            minWidth: 20,
            minHeight: 20,
          })),
        }),
      ],
    });
    expect(result.omissionSummary.byReason["content-item-count-cap"]).toBe(
      2872,
    );
    expect(
      result.omissionSummary.samples["content-item-count-cap"],
    ).toHaveLength(8);
  });

  it("reserves width for explicit room and content minima", () => {
    const roomMinimum = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      maximumExpandedCanvasWidth: 2200,
      maximumExpandedRoomWidth: 2000,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [room("room-minimum", { contentMinWidth: 1800 })],
    });
    expect(roomMinimum.layout.rooms[0].width).toBeGreaterThanOrEqual(1800);

    const contentMinimum = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      maximumExpandedCanvasWidth: 2200,
      maximumExpandedRoomWidth: 2000,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [
        room("content-minimum", {
          contentItems: [
            {
              id: "wide-board",
              kind: "board",
              importance: "required",
              order: 0,
              minWidth: 1600,
              minHeight: 20,
            },
          ],
        }),
      ],
    });
    expect(contentMinimum.layout.rooms[0].width).toBeGreaterThanOrEqual(1600);
    expect(contentMinimum.contentItems[0].width).toBeGreaterThanOrEqual(1600);
  });

  it("places the first column item in row zero and honors exact row capacity", () => {
    const oneRow = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      maxLayoutRows: 1,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [
        room("column-one", {
          flow: "column",
          contentItems: [
            {
              id: "first",
              kind: "board",
              importance: "required",
              order: 0,
              minWidth: 40,
              minHeight: 40,
            },
          ],
        }),
      ],
    });
    expect(oneRow.contentItems).toHaveLength(1);
    expect(oneRow.contentItems[0].y).toBe(
      oneRow.layout.rooms[0].contentSafeRect.y,
    );

    const twoRows = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      maxLayoutRows: 2,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [
        room("column-two", {
          flow: "column",
          contentItems: [
            {
              id: "first",
              kind: "board",
              importance: "required",
              order: 0,
              minWidth: 40,
              minHeight: 40,
            },
            {
              id: "second",
              kind: "board",
              importance: "required",
              order: 1,
              minWidth: 40,
              minHeight: 40,
            },
          ],
        }),
      ],
    });
    expect(twoRows.contentItems).toHaveLength(2);
    expect(twoRows.contentItems[1].y).toBeGreaterThan(
      twoRows.contentItems[0].y,
    );
    expect(twoRows.contentItems[1].y).toBe(
      twoRows.contentItems[0].y + twoRows.contentItems[0].height + 8,
    );
  });

  it("keeps row flow bounded while wrapping and spanning remain explicit", () => {
    const items = [
      {
        id: "first",
        kind: "board",
        importance: "required" as const,
        order: 0,
        minWidth: 40,
        minHeight: 40,
        preferredWidth: 160,
      },
      {
        id: "second",
        kind: "board",
        importance: "required" as const,
        order: 1,
        minWidth: 40,
        minHeight: 40,
        preferredWidth: 160,
      },
    ];
    const row = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [
        room("row-flow", {
          title: "ROOM",
          hostTitle: "HOST",
          flow: "row",
          contentItems: items,
        }),
      ],
    });
    expect(row.contentItems).toHaveLength(1);
    expect(row.omissionSummary.byReason["canvas-capacity-exhausted"]).toBe(1);

    const wrapped = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [
        room("grid-flow", {
          title: "ROOM",
          hostTitle: "HOST",
          flow: "grid",
          contentItems: items,
        }),
      ],
    });
    expect(wrapped.contentItems).toHaveLength(2);
    expect(wrapped.contentItems[1].y).toBeGreaterThan(
      wrapped.contentItems[0].y,
    );

    const spanning = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [
        room("span-flow", {
          title: "ROOM",
          hostTitle: "HOST",
          spanPolicy: "multi-row",
          contentItems: [items[0]],
        }),
      ],
    });
    expect(spanning.contentItems[0].width).toBe(
      spanning.layout.rooms[0].contentSafeRect.width,
    );
  });

  it("uses the bounded fallback when fixed chrome cannot fit the room cap", () => {
    const result = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      maximumExpandedRoomHeight: 4096,
      style: {
        fixedHeaderChromeHeight: 4096,
        overflowMarkerMinHeight: 4096,
        overflowMarkerGap: 1,
      },
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [room()],
    });
    expect(result.normalizationErrors).toEqual(["invalid-style-capacity"]);
    expect(result.fallbackMessage).toBe("Office layout unavailable");
    expect(result.layout.overflowMarker?.label).toBe(
      "Office layout unavailable",
    );
  });

  it("keeps the CEO region bounded by both vertical caps and accounts for omitted receptions", () => {
    const result = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      maximumExpandedCanvasHeight: 320,
      maximumExpandedRoomHeight: 280,
      ceoReceptionCount: 6,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [],
    });
    const { layout } = result;
    const canvas = {
      x: 0,
      y: 0,
      width: result.resolvedCanvasWidth,
      height: result.resolvedCanvasHeight,
    };
    expect(contains(canvas, layout.ceoRect)).toBe(true);
    expect(contains(canvas, layout.agentBarRect)).toBe(true);
    expect(
      layout.ceoBlocks.receptions.every(
        (reception) =>
          reception.y + reception.height <= result.resolvedCanvasHeight,
      ),
    ).toBe(true);
    expect(result.omissionSummary.byReason["canvas-capacity-exhausted"]).toBe(
      6,
    );
    expect(result.omissionSummary.byImportance.required).toBe(6);
    expect(result.accessibleOverflow?.required).toBe(true);
    expect(layout.ceoOverflowMarkerRect).toBeDefined();
    expect(contains(layout.ceoRect, layout.ceoOverflowMarkerRect!)).toBe(true);
  });

  it("omits content whose minimum width cannot fit the capped content-safe area", () => {
    const exactCap = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      maximumExpandedCanvasWidth: 1000,
      maximumExpandedRoomWidth: 300,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [
        room("exact-cap", {
          title: "ROOM",
          hostTitle: "HOST",
          contentItems: [
            {
              id: "exact-cap-item",
              kind: "board",
              importance: "required",
              order: 0,
              minWidth: 300,
              minHeight: 20,
            },
          ],
        }),
      ],
    });
    expect(exactCap.layout.rooms[0].width).toBeLessThanOrEqual(300);
    expect(exactCap.contentItems).toHaveLength(0);
    expect(exactCap.omissions).toContainEqual({
      reason: "required-minimum-exceeds-room-cap",
      importance: "required",
      id: "exact-cap-item",
    });
    expect(exactCap.layout.rooms[0].overflowMarkerRect).toBeDefined();
    expect(
      contains(
        exactCap.layout.rooms[0].contentSafeRect,
        exactCap.layout.rooms[0].overflowMarkerRect!,
      ),
    ).toBe(true);

    const rowMinimums = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      maximumExpandedCanvasWidth: 1000,
      maximumExpandedRoomWidth: 300,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [
        room("row-cap", {
          title: "ROOM",
          hostTitle: "HOST",
          flow: "row",
          contentItems: [
            {
              id: "row-a",
              kind: "board",
              importance: "required",
              order: 0,
              minWidth: 180,
              minHeight: 20,
            },
            {
              id: "row-b",
              kind: "board",
              importance: "required",
              order: 1,
              minWidth: 180,
              minHeight: 20,
            },
          ],
        }),
      ],
    });
    expect(rowMinimums.layout.rooms[0].width).toBeLessThanOrEqual(300);
    expect(rowMinimums.contentItems).toHaveLength(1);
    expect(
      rowMinimums.omissionSummary.byReason["canvas-capacity-exhausted"],
    ).toBe(1);
    expect(rowMinimums.layout.rooms[0].overflowMarkerRect).toBeDefined();
  });

  it("falls back when horizontal header chrome cannot fit the room ceiling", () => {
    const result = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      maximumExpandedCanvasWidth: 1000,
      maximumExpandedRoomWidth: 300,
      style: {
        fixedHeaderChromeWidth: 400,
        roomSafeInset: 24,
      },
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [room("style-capacity")],
    });
    const canvas = {
      x: 0,
      y: 0,
      width: result.resolvedCanvasWidth,
      height: result.resolvedCanvasHeight,
    };
    expect(result.normalizationErrors).toEqual(["invalid-style-capacity"]);
    expect(result.fallbackMessage).toBe("Office layout unavailable");
    expect(result.layout.rooms).toHaveLength(0);
    expect(result.layout.ceoOverflowMarkerRect).toBeDefined();
    expect(contains(canvas, result.layout.ceoRect)).toBe(true);
    expect(
      contains(result.layout.ceoRect, result.layout.ceoOverflowMarkerRect!),
    ).toBe(true);
    expect(result.resolvedCanvasWidth).toBeLessThanOrEqual(1000);
  });

  it("keeps large descriptor and publication state bounded while retaining exact omission totals", () => {
    const result = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      maxContentItems: 128,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [
        room("large-input", {
          contentItems: Array.from({ length: 3000 }, (_, index) => ({
            id: `large-${index}`,
            kind: "board",
            importance: "optional" as const,
            order: index,
            minWidth: 20,
            minHeight: 20,
          })),
        }),
      ],
    });
    const normalizedRoom = result.normalizedInput.rooms[0];
    expect(normalizedRoom.contentItemCount).toBe(3000);
    expect(normalizedRoom.contentItems).toHaveLength(128);
    expect(result.omissionSummary.byReason["content-item-count-cap"]).toBe(
      2872,
    );
    expect(
      result.omissionSummary.samples["content-item-count-cap"],
    ).toHaveLength(8);
    expect(result.inputDigest).toMatch(/^office-v1-[0-9a-f]{16}$/);

    const publisher = new OfficeLayoutPublisher();
    const first = publisher.publish(
      { canonicalDigest: result.inputDigest },
      result,
    );
    for (let index = 0; index < OFFICE_GEOMETRY.maxRooms * 2; index += 1) {
      const next = resolveOfficeGeometry({
        availableViewportWidth: 1000,
        titleMode: "expand",
        roomAlignment: index % 2 === 0 ? "left" : "center",
        rooms: [room(`generation-transition-${index}`)],
      });
      publisher.publish({ canonicalDigest: next.inputDigest }, next);
      const returned = publisher.publish(
        { canonicalDigest: first.inputDigest },
        result,
      );
      expect(returned.layoutRevision).toBe(3 + index * 2);
    }
    expect(
      (publisher as unknown as { generationDigests?: unknown })
        .generationDigests,
    ).toBeUndefined();
    expect(
      (publisher as unknown as { generationOrder?: unknown }).generationOrder,
    ).toBeUndefined();
    expect(first.normalizedInput.rooms[0].contentItems).toHaveLength(128);
  });

  it("uses declared order for required items and priority then order for other items", () => {
    const required = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      maxContentItems: 1,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [
        room("required-order", {
          title: "ROOM",
          hostTitle: "HOST",
          contentItems: [
            {
              id: "declared-second",
              kind: "board",
              importance: "required",
              order: 2,
              priority: 999,
              minWidth: 20,
              minHeight: 20,
            },
            {
              id: "declared-first",
              kind: "board",
              importance: "required",
              order: 1,
              priority: 0,
              minWidth: 20,
              minHeight: 20,
            },
          ],
        }),
      ],
    });
    expect(required.contentItems[0].id).toBe("declared-first");
    expect(required.omissionSummary.byReason["content-item-count-cap"]).toBe(1);

    const other = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      maxContentItems: 6,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [
        room("priority-order", {
          title: "ROOM",
          hostTitle: "HOST",
          contentItems: [
            {
              id: "preferred-low",
              kind: "board",
              importance: "preferred",
              order: 0,
              priority: 1,
              minWidth: 20,
              minHeight: 20,
            },
            {
              id: "preferred-high",
              kind: "board",
              importance: "preferred",
              order: 1,
              priority: 5,
              minWidth: 20,
              minHeight: 20,
            },
            {
              id: "preferred-tie-b",
              kind: "board",
              importance: "preferred",
              order: 3,
              priority: 2,
              minWidth: 20,
              minHeight: 20,
            },
            {
              id: "preferred-tie-a",
              kind: "board",
              importance: "preferred",
              order: 2,
              priority: 2,
              minWidth: 20,
              minHeight: 20,
            },
            {
              id: "optional-high",
              kind: "board",
              importance: "optional",
              order: 0,
              priority: 100,
              minWidth: 20,
              minHeight: 20,
            },
          ],
        }),
      ],
    });
    expect(other.contentItems.map(({ id }) => id)).toEqual([
      "preferred-high",
      "preferred-tie-a",
      "preferred-tie-b",
      "preferred-low",
      "optional-high",
    ]);
  });

  it("orders generic descriptor metadata deterministically before bounded truncation", () => {
    const descriptors = [
      room("work-b", { region: "work", precedence: 1, order: 1 }),
      room("agent-bar", { region: "agent-bar", precedence: 9, order: 0 }),
      room("ceo-b", { region: "ceo", precedence: 2, order: 1 }),
      room("work-a", { region: "work", precedence: 1, order: 0 }),
      room("ceo-a", { region: "ceo", precedence: 1, order: 0 }),
    ];
    const base = {
      availableViewportWidth: 1000,
      titleMode: "expand" as const,
      roomAlignment: "left" as const,
      rooms: descriptors,
    };
    const first = normalizeOfficeGeometryInput(base);
    const shuffled = normalizeOfficeGeometryInput({
      ...base,
      rooms: [...descriptors].reverse(),
    });
    const ids = first.rooms.map(({ id }) => id);
    expect(ids).toEqual(["ceo-a", "ceo-b", "agent-bar", "work-a", "work-b"]);
    expect(shuffled.rooms.map(({ id }) => id)).toEqual(ids);

    const bounded = normalizeOfficeGeometryInput({
      ...base,
      maxContentItems: 1,
      rooms: Array.from({ length: 130 }, (_, index) =>
        room(`work-${index}`, {
          region: "work",
          precedence: index,
          order: 0,
        }),
      ).reverse(),
    });
    expect(bounded.rooms).toHaveLength(128);
    expect(bounded.rooms[0].precedence).toBe(0);
    expect(bounded.rooms[bounded.rooms.length - 1]?.precedence).toBe(127);
  });

  it("keeps wide, narrow, Unicode, and emoji emergency labels inside the capped header", () => {
    for (const [index, title] of [
      "WWWWWWWWWWWWWWWWWWWWWW",
      "iiiiiiiiiiiiiiiiiiiiiiiiiiii",
      "東京の長いオフィス名",
      "🧑🏽‍💻🚀✨🚀✨🚀✨🚀✨",
    ].entries()) {
      const result = resolveOfficeGeometry({
        availableViewportWidth: 1000,
        maximumExpandedRoomWidth: 300,
        titleMode: "expand",
        roomAlignment: "left",
        rooms: [
          room(`label-${index}`, {
            title,
            hostTitle: `${title}-host`,
            deskCount: 0,
          }),
        ],
      });
      const header = result.roomHeaders[0]!;
      const rect = result.layout.rooms[0];
      expect(header.emergencyEllipsis).toBe(true);
      expect(rect.width).toBeLessThanOrEqual(300);
      expect(header.titleBoxWidth).toBeLessThanOrEqual(
        rect.headerRect.width -
          2 *
            (header.actionWidth +
              header.actionGap +
              header.actionWidth +
              header.closeGap) +
          1,
      );
      expect(`${header.workspace}${header.host}`).toContain("…");
    }
  });

  it("uses the published Agent Bar rectangle and rejects stale or future presenter acknowledgements", () => {
    const result = resolveOfficeGeometry({
      availableViewportWidth: 1000,
      titleMode: "expand",
      roomAlignment: "left",
      rooms: [],
    });
    const publisher = new OfficeLayoutPublisher();
    const published = publisher.publish(
      { canonicalDigest: result.inputDigest },
      result,
    );
    expect(published.agentBarRect).toEqual(result.layout.agentBarRect);
    expect(publisher.isCanvasReady(published.layoutRevision)).toBe(false);
    expect(publisher.ackCanvasRendered(published.layoutRevision - 1)).toBe(
      false,
    );
    expect(publisher.ackCanvasRendered(published.layoutRevision + 1)).toBe(
      false,
    );
    expect(publisher.isCanvasReady(published.layoutRevision)).toBe(false);
    expect(publisher.ackCanvasRendered(published.layoutRevision)).toBe(true);
    expect(publisher.isCanvasReady(published.layoutRevision)).toBe(true);
  });
});
