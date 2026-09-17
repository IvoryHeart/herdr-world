import { describe, expect, test } from "bun:test";

const it = test;
import {
  deskAnchor,
  agentBarSlot,
  minimumOfficeWidthForReceptions,
  OFFICE_GEOMETRY,
  receptionAgentAnchor,
  receptionTableRect,
  resolveCeoBlockLayout,
  resolveOfficeLayout,
  standingAnchor,
} from "./officeGeometry";

describe("Pixel Office geometry", () => {
  it("uses an elastic room grid at a readable logical width", () => {
    const narrow = resolveOfficeLayout(
      375,
      Array.from({ length: 6 }, () => ({
        deskCount: 1,
        standingCount: 0,
      })),
    );
    expect(narrow).toMatchObject({
      officeWidth: 1000,
      columns: 3,
      rows: 2,
    });
    expect(narrow.rooms).toHaveLength(6);
    expect(narrow.roomStartY).toBe(
      OFFICE_GEOMETRY.ceoBandHeight + OFFICE_GEOMETRY.hallwayHeight,
    );
    const lastRoom = narrow.rooms[narrow.rooms.length - 1];
    expect(narrow.totalHeight).toBeGreaterThan(lastRoom.y + lastRoom.height);
  });

  it("fits three ordinary rooms across one full-width row", () => {
    const layout = resolveOfficeLayout(
      1200,
      Array.from({ length: 3 }, () => ({
        deskCount: 2,
        standingCount: 0,
      })),
      "center",
    );
    expect(layout.columns).toBe(3);
    expect(layout.rows).toBe(1);
    expect(layout.rooms[0].x).toBe(200);
    const lastRoom = layout.rooms[layout.rooms.length - 1];
    expect(lastRoom.x + lastRoom.width).toBe(1000);
    expect(
      layout.rooms[1].x - (layout.rooms[0].x + layout.rooms[0].width),
    ).toBe(OFFICE_GEOMETRY.roomGap);
    expect(layout.rooms.map(({ width }) => width)).toEqual([
      layout.rooms[0].width,
      layout.rooms[0].width,
      layout.rooms[0].width,
    ]);
  });

  it("expands rooms deterministically for second desk and standing rows", () => {
    const layout = resolveOfficeLayout(1000, [
      { deskCount: 4, standingCount: 0 },
      { deskCount: 8, standingCount: 8 },
      { deskCount: 0, standingCount: 16 },
    ]);
    expect(layout.rooms[1]).toMatchObject({ deskRows: 2, standingRows: 1 });
    expect(layout.rooms[2]).toMatchObject({ deskRows: 0, standingRows: 2 });
    expect(layout.rooms[1].height).toBeGreaterThan(layout.rooms[0].height);
    expect(layout.rooms[2].height).toBeGreaterThan(
      OFFICE_GEOMETRY.minRoomHeight,
    );
  });

  it("keeps furniture spacing stable in a partial final room row", () => {
    const layout = resolveOfficeLayout(
      1400,
      Array.from({ length: 7 }, () => ({
        deskCount: 2,
        standingCount: 0,
      })),
    );
    const firstRoom = layout.rooms[0];
    const finalRowRoom = layout.rooms[layout.columns];
    expect(finalRowRoom.width).toBe(firstRoom.width);
    expect(finalRowRoom.x).toBe(firstRoom.x);
    const firstRowBottom = Math.max(
      ...layout.rooms
        .filter(({ row }) => row === firstRoom.row)
        .map(({ y, height }) => y + height),
    );
    const roadGap = finalRowRoom.y - firstRowBottom;
    expect(roadGap).toBe(OFFICE_GEOMETRY.roomRowGap);
    expect(roadGap).toBeGreaterThanOrEqual(
      OFFICE_GEOMETRY.shadowAllowance * 2 +
        OFFICE_GEOMETRY.selectionStrokeAllowance * 2,
    );
    expect(deskAnchor(finalRowRoom, 0).stationSpan).toBe(
      deskAnchor(firstRoom, 0).stationSpan,
    );
  });

  it("does not inherit a dense room width in the next row", () => {
    const layout = resolveOfficeLayout(1400, [
      { deskCount: 8, standingCount: 0 },
      { deskCount: 2, standingCount: 0 },
      { deskCount: 2, standingCount: 0 },
      { deskCount: 2, standingCount: 0 },
      { deskCount: 2, standingCount: 0 },
      { deskCount: 2, standingCount: 0 },
      { deskCount: 2, standingCount: 0 },
    ]);
    const denseRoom = layout.rooms[0];
    const nextRowRoom = layout.rooms[layout.columns];
    expect(nextRowRoom.width).toBeLessThan(denseRoom.width);
    expect(deskAnchor(nextRowRoom, 0).stationSpan).toBe(
      deskAnchor(denseRoom, 0).stationSpan,
    );
  });

  it("packs later rows independently of a dense room in the first row", () => {
    const layout = resolveOfficeLayout(1700, [
      { deskCount: 8, standingCount: 0 },
      ...Array.from({ length: 11 }, () => ({ deskCount: 2, standingCount: 0 })),
    ]);
    expect(
      layout.rooms
        .slice(0, layout.columns)
        .some(({ deskColumns }) => deskColumns === 4),
    ).toBe(true);
    expect(layout.rooms.filter(({ row }) => row === 1)).toHaveLength(6);
  });

  it("supports left, center, and right room-row alignment", () => {
    const rooms = Array.from({ length: 2 }, () => ({
      deskCount: 2,
      standingCount: 0,
    }));
    const left = resolveOfficeLayout(1200, rooms, "left");
    const center = resolveOfficeLayout(1200, rooms, "center");
    const right = resolveOfficeLayout(1200, rooms, "right");
    expect(left.rooms[0].x).toBe(12);
    expect(center.rooms[0].x).toBeGreaterThan(left.rooms[0].x);
    const lastRightRoom = right.rooms[right.rooms.length - 1];
    expect(lastRightRoom.x + lastRightRoom.width).toBe(1188);
  });

  it("spreads the CEO blocks and doubles the wide-screen Agent Bar", () => {
    const blocks = resolveCeoBlockLayout(1700, 1);
    expect(blocks.agentBarWidth).toBe(OFFICE_GEOMETRY.agentBarPreferredWidth);
    expect(blocks.blockGap).toBeGreaterThan(OFFICE_GEOMETRY.ceoCompactBlockGap);
    expect(blocks.agentBarX + blocks.agentBarWidth).toBe(
      1700 - OFFICE_GEOMETRY.ceoEdgePadding,
    );
  });

  it("packs the first Agent Bar row beside the counter", () => {
    const blocks = resolveCeoBlockLayout(1700, 1);
    const counterRow = agentBarSlot(blocks, 0);
    const backRow = agentBarSlot(blocks, counterRow.columns);
    expect(counterRow.rowY).toBeGreaterThan(backRow.rowY);
    expect(counterRow.characterFeetY).toBeGreaterThan(backRow.characterFeetY);
  });

  it("keeps CEO and all host reception desks on one bounded horizontal row", () => {
    const officeWidth = minimumOfficeWidthForReceptions(6);
    const blocks = resolveCeoBlockLayout(officeWidth, 6);
    const receptions = blocks.receptions;
    expect(officeWidth).toBeGreaterThanOrEqual(OFFICE_GEOMETRY.minOfficeWidth);
    expect(receptions).toHaveLength(6);
    expect(blocks.ceoScale).toBe(1);
    expect(blocks.localBlockGap).toBe(OFFICE_GEOMETRY.ceoCompactBlockGap);
    expect(blocks.ceoX).toBe(OFFICE_GEOMETRY.ceoEdgePadding);
    expect(blocks.otelBoardX).toBe(
      blocks.ceoX +
        blocks.ceoScale * OFFICE_GEOMETRY.ceoDeskWidth +
        blocks.blockGap,
    );
    expect(blocks.boardX).toBe(
      blocks.otelBoardX +
        blocks.ceoScale * OFFICE_GEOMETRY.ceoOtelBoardWidth +
        blocks.blockGap,
    );
    expect(receptions[0].x).toBe(
      blocks.boardX +
        blocks.ceoScale * OFFICE_GEOMETRY.ceoBoardWidth +
        blocks.blockGap,
    );
    expect(new Set(receptions.map(({ y }) => y))).toEqual(new Set([36]));
    expect(
      receptions.every(
        ({ width }) => width <= OFFICE_GEOMETRY.receptionStationMinWidth,
      ),
    ).toBe(true);
    expect(
      receptions.every(({ gapBefore }) => gapBefore === blocks.blockGap),
    ).toBe(true);
    expect(
      receptions[1].x - (receptions[0].x + receptions[0].width),
    ).toBeCloseTo(blocks.blockGap);
    const lastReception = receptions[receptions.length - 1];
    expect(lastReception.x + lastReception.width).toBeLessThanOrEqual(
      officeWidth - 12,
    );
    expect(blocks.agentBarX).toBeGreaterThan(
      lastReception.x + lastReception.width,
    );
    expect(blocks.agentBarX + blocks.agentBarWidth).toBe(
      officeWidth - OFFICE_GEOMETRY.ceoEdgePadding,
    );
    const agents = Array.from({ length: 4 }, (_, index) =>
      receptionAgentAnchor(receptions[0], index),
    );
    expect(new Set(agents.map(({ x }) => x)).size).toBe(4);
    expect(agents[1].x - agents[0].x).toBeCloseTo(agents[0].stationSpan);
    const table = receptionTableRect(receptions[0]);
    const centeredTableX =
      receptions[0].x + (receptions[0].width - table.width) / 2;
    expect(table.width).toBeLessThanOrEqual(
      OFFICE_GEOMETRY.receptionTableWidth,
    );
    expect(table.x).toBe(centeredTableX + OFFICE_GEOMETRY.receptionTableNudgeX);
    expect(table.x).toBeGreaterThan(receptions[0].x);
    expect(table.x + table.width).toBeLessThan(
      receptions[0].x + receptions[0].width,
    );
  });

  it("places eight desks in four columns and two rows without collisions", () => {
    const layout = resolveOfficeLayout(1000, [
      { deskCount: 8, standingCount: 8 },
    ]);
    const anchors = Array.from({ length: 8 }, (_, index) =>
      deskAnchor(layout.rooms[0], index),
    );
    expect(anchors.map(({ column }) => column)).toEqual([
      0, 1, 2, 3, 0, 1, 2, 3,
    ]);
    expect(anchors.map(({ row }) => row)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    expect(anchors.every(({ stationSpan }) => stationSpan >= 112)).toBe(true);
    expect(new Set(anchors.map(({ x, deskY }) => `${x}:${deskY}`)).size).toBe(
      8,
    );
    expect(anchors[0].nameY).toBe(
      layout.rooms[0].y + 42 + OFFICE_GEOMETRY.deskTopOffset,
    );
    expect(anchors[4].nameY - anchors[0].nameY).toBe(
      OFFICE_GEOMETRY.deskRowHeight,
    );
    expect(
      anchors.every(
        ({ characterFeetY, deskY }) => characterFeetY - deskY === 20,
      ),
    ).toBe(true);
  });

  it("places up to sixteen standing agents after the desk rows", () => {
    const layout = resolveOfficeLayout(1000, [
      { deskCount: 8, standingCount: 16 },
    ]);
    const desks = Array.from({ length: 8 }, (_, index) =>
      deskAnchor(layout.rooms[0], index),
    );
    const standing = Array.from({ length: 16 }, (_, index) =>
      standingAnchor(layout.rooms[0], index),
    );
    expect(standing.map(({ row }) => row)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
    ]);
    expect(Math.min(...standing.map(({ nameY }) => nameY))).toBeGreaterThan(
      Math.max(...desks.map(({ deskY }) => deskY)),
    );
  });

  it("does not invent rooms and clamps pathological counts", () => {
    expect(resolveOfficeLayout(1000, 0).rooms).toHaveLength(0);
    expect(resolveOfficeLayout(1000, 10_000).rooms).toHaveLength(128);
  });
});
