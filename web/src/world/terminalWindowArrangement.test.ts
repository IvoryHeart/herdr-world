import { describe, expect, test } from "bun:test";
import {
  resolveTerminalWindowArrangement,
  terminalArrangementContentWidth,
  terminalArrangementScrollLeftForWindow,
  terminalArrangementWindowVisible,
  terminalGridContentHeight,
  terminalGridScrollTopForWindow,
  terminalGridWindowVisible,
  terminalWindowArrangementReason,
  type TerminalWindowArrangementWindow,
} from "./terminalWindowArrangement";

const stage = { left: 20, top: 60, width: 1200, height: 900 };

function windows(count: number): TerminalWindowArrangementWindow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `tab-${index + 1}`,
    minWidth: 420,
    minHeight: 280,
  }));
}

function placements(
  preset: "single" | "cascade" | "columns" | "rows" | "grid",
  count: number,
) {
  const result = resolveTerminalWindowArrangement(
    preset,
    stage,
    windows(count),
    `tab-${count}`,
  );
  if (!result.available) throw new Error(result.reason);
  return result.placements;
}

describe("terminal window arrangements", () => {
  test("Single fills an offset stage with only the active window", () => {
    expect(placements("single", 3)).toEqual([{ id: "tab-3", geometry: stage }]);
    expect(
      resolveTerminalWindowArrangement("single", stage, windows(2), "missing"),
    ).toEqual({ available: false, reason: "Active window is unavailable." });
  });

  test("Columns and Rows tile every window without overlap", () => {
    expect(placements("columns", 2)).toEqual([
      {
        id: "tab-1",
        geometry: { left: 20, top: 60, width: 596, height: 900 },
      },
      {
        id: "tab-2",
        geometry: { left: 624, top: 60, width: 596, height: 900 },
      },
    ]);
    expect(placements("rows", 3)).toEqual([
      {
        id: "tab-1",
        geometry: { left: 20, top: 60, width: 1200, height: 294.6666666666667 },
      },
      {
        id: "tab-2",
        geometry: {
          left: 20,
          top: 362.6666666666667,
          width: 1200,
          height: 294.6666666666667,
        },
      },
      {
        id: "tab-3",
        geometry: {
          left: 20,
          top: 665.3333333333334,
          width: 1200,
          height: 294.6666666666667,
        },
      },
    ]);
  });

  test("Columns and Rows shrink normal floating minimums for more windows", () => {
    const threeColumns = resolveTerminalWindowArrangement(
      "columns",
      { ...stage, width: 1000 },
      windows(3),
      "tab-3",
    );
    const fourColumns = resolveTerminalWindowArrangement(
      "columns",
      { ...stage, width: 1000 },
      windows(4),
      "tab-4",
    );
    const fourRows = resolveTerminalWindowArrangement(
      "rows",
      { ...stage, height: 800 },
      windows(4),
      "tab-4",
    );
    expect(threeColumns.available).toBe(true);
    expect(fourColumns.available).toBe(true);
    expect(fourRows.available).toBe(true);
    if (!threeColumns.available || !fourRows.available) return;
    expect(threeColumns.placements).toHaveLength(3);
    if (!fourColumns.available) return;
    expect(fourColumns.placements).toHaveLength(4);
    expect(fourRows.placements).toHaveLength(4);
    expect(threeColumns.placements[0]!.geometry.width).toBeGreaterThanOrEqual(
      220,
    );
    expect(fourRows.placements[0]!.geometry.height).toBeGreaterThanOrEqual(160);
  });

  test("Grid uses two columns, a tall left tile for three, and four corners", () => {
    expect(placements("grid", 2).map(({ geometry }) => geometry)).toEqual(
      placements("columns", 2).map(({ geometry }) => geometry),
    );
    expect(placements("grid", 3)).toEqual([
      {
        id: "tab-1",
        geometry: { left: 20, top: 60, width: 596, height: 900 },
      },
      {
        id: "tab-2",
        geometry: { left: 624, top: 60, width: 596, height: 446 },
      },
      {
        id: "tab-3",
        geometry: { left: 624, top: 514, width: 596, height: 446 },
      },
    ]);
    expect(placements("grid", 4).map(({ geometry }) => geometry)).toEqual([
      { left: 20, top: 60, width: 596, height: 446 },
      { left: 624, top: 60, width: 596, height: 446 },
      { left: 20, top: 514, width: 596, height: 446 },
      { left: 624, top: 514, width: 596, height: 446 },
    ]);
  });

  test("Grid tiles six in three columns and sixteen in four rows and columns", () => {
    for (const [count, columns, rows] of [
      [6, 3, 2],
      [16, 4, 4],
    ]) {
      const result = placements("grid", count!);
      expect(result).toHaveLength(count!);
      expect(result.map(({ id }) => id)).toEqual(
        windows(count!).map(({ id }) => id),
      );
      expect(new Set(result.map(({ geometry }) => geometry.left)).size).toBe(
        columns,
      );
      expect(new Set(result.map(({ geometry }) => geometry.top)).size).toBe(
        rows,
      );
      for (const item of result) {
        expect(item.geometry.width).toBeGreaterThanOrEqual(220);
        expect(item.geometry.height).toBeGreaterThanOrEqual(160);
        expect(item.geometry.left + item.geometry.width).toBeLessThanOrEqual(
          stage.left + stage.width,
        );
        expect(item.geometry.top + item.geometry.height).toBeLessThanOrEqual(
          stage.top + stage.height,
        );
      }
    }
  });

  test("Grid keeps a usable tile size and adds scrollable rows for 1024 windows", () => {
    const result = placements("grid", 1024);
    expect(result).toHaveLength(1024);
    expect(new Set(result.map(({ geometry }) => geometry.left)).size).toBe(5);
    expect(result[1023]!.geometry.top).toBeGreaterThan(stage.height);
    expect(
      result.every(
        ({ geometry }) => geometry.width >= 220 && geometry.height >= 160,
      ),
    ).toBe(true);
    const contentHeight = terminalGridContentHeight(
      result,
      stage.height,
      stage.top,
    );
    expect(contentHeight).toBeGreaterThan(stage.height);
    expect(
      result.filter(({ geometry }) =>
        terminalGridWindowVisible(geometry, 0, stage.height, stage.top),
      ).length,
    ).toBeLessThan(70);
    const last = result[1023]!.geometry;
    const scrolled = terminalGridScrollTopForWindow(
      last,
      0,
      stage.height,
      contentHeight,
      stage.top,
    );
    expect(scrolled).toBeGreaterThan(0);
    expect(
      terminalGridWindowVisible(last, scrolled, stage.height, stage.top),
    ).toBe(true);
  });

  test("Columns and Rows keep usable tiles and scroll through 1024 windows", () => {
    const columns = placements("columns", 1024);
    const rows = placements("rows", 1024);
    expect(columns[0]!.geometry.width).toBe(220);
    expect(rows[0]!.geometry.height).toBe(160);
    const contentWidth = terminalArrangementContentWidth(
      columns,
      stage.width,
      stage.left,
    );
    const contentHeight = terminalGridContentHeight(
      rows,
      stage.height,
      stage.top,
    );
    expect(contentWidth).toBeGreaterThan(stage.width);
    expect(contentHeight).toBeGreaterThan(stage.height);
    const left = terminalArrangementScrollLeftForWindow(
      columns[1023]!.geometry,
      0,
      stage.width,
      contentWidth,
      stage.left,
    );
    const top = terminalGridScrollTopForWindow(
      rows[1023]!.geometry,
      0,
      stage.height,
      contentHeight,
      stage.top,
    );
    expect(left).toBeGreaterThan(0);
    expect(top).toBeGreaterThan(0);
    expect(
      terminalArrangementWindowVisible(
        columns[1023]!.geometry,
        left,
        0,
        stage.width,
        stage.height,
        stage.left,
        stage.top,
      ),
    ).toBe(true);
    expect(
      terminalArrangementWindowVisible(
        rows[1023]!.geometry,
        0,
        top,
        stage.width,
        stage.height,
        stage.left,
        stage.top,
      ),
    ).toBe(true);
    expect(
      columns.filter(({ geometry }) =>
        terminalArrangementWindowVisible(
          geometry,
          0,
          0,
          stage.width,
          stage.height,
          stage.left,
          stage.top,
        ),
      ).length,
    ).toBeLessThan(20);
    expect(
      rows.filter(({ geometry }) =>
        terminalArrangementWindowVisible(
          geometry,
          0,
          0,
          stage.width,
          stage.height,
          stage.left,
          stage.top,
        ),
      ).length,
    ).toBeLessThan(20);
  });

  test("Grid explains when the stage cannot fit one usable column", () => {
    expect(
      terminalWindowArrangementReason(
        "grid",
        { ...stage, width: 180 },
        windows(36),
        "tab-36",
      ),
    ).toContain("width");
  });

  test("Cascade exposes older titles and preserves back-to-front focus order", () => {
    const result = placements("cascade", 4);
    expect(result.map(({ id }) => id)).toEqual([
      "tab-1",
      "tab-2",
      "tab-3",
      "tab-4",
    ]);
    expect(result.map(({ geometry }) => geometry.top)).toEqual([
      60, 108, 156, 204,
    ]);
    expect(result.map(({ geometry }) => geometry.left)).toEqual([
      20, 52, 84, 116,
    ]);
    expect(result.every(({ geometry }) => geometry.width >= 420)).toBe(true);
    expect(result.every(({ geometry }) => geometry.width === 760)).toBe(true);
    expect(result.every(({ geometry }) => geometry.height === 520)).toBe(true);
    const tallerTitle = windows(2);
    tallerTitle[0] = { ...tallerTitle[0]!, titleHeight: 70 };
    const custom = resolveTerminalWindowArrangement(
      "cascade",
      stage,
      tallerTitle,
      "tab-2",
    );
    expect(custom.available && custom.placements[1]?.geometry.top).toBe(138);
  });

  test("Cascade repeats a reachable diagonal in scrollable stages for 1024 windows", () => {
    const result = placements("cascade", 1024);
    expect(result).toHaveLength(1024);
    const firstPageEnd = result.findIndex(
      ({ geometry }) => geometry.top >= stage.top + stage.height,
    );
    expect(firstPageEnd).toBeGreaterThan(4);
    expect(result[firstPageEnd]!.geometry.left).toBe(stage.left);
    expect(result[firstPageEnd]!.geometry.top).toBe(
      stage.top + stage.height + 8,
    );
    expect(
      result.every(
        ({ geometry }) => geometry.width >= 420 && geometry.height >= 280,
      ),
    ).toBe(true);
    expect(
      result[firstPageEnd - 1]!.geometry.top +
        result[firstPageEnd - 1]!.geometry.height,
    ).toBeLessThanOrEqual(stage.top + stage.height);
    const contentHeight = terminalGridContentHeight(
      result,
      stage.height,
      stage.top,
    );
    const last = result[1023]!.geometry;
    const scrollTop = terminalGridScrollTopForWindow(
      last,
      0,
      stage.height,
      contentHeight,
      stage.top,
    );
    expect(scrollTop).toBeGreaterThan(0);
    expect(
      terminalGridWindowVisible(last, scrollTop, stage.height, stage.top),
    ).toBe(true);
  });

  test("unavailable presets return reasons and do not produce partial geometry", () => {
    expect(
      terminalWindowArrangementReason("rows", stage, windows(1), "tab-1"),
    ).toContain("another eligible window");
    expect(
      terminalWindowArrangementReason(
        "columns",
        { ...stage, width: 180 },
        windows(2),
        "tab-2",
      ),
    ).toContain("width");
    expect(
      terminalWindowArrangementReason(
        "rows",
        { ...stage, height: 120 },
        windows(3),
        "tab-3",
      ),
    ).toContain("height");
    expect(
      terminalWindowArrangementReason(
        "grid",
        { ...stage, width: 180 },
        windows(5),
        "tab-5",
      ),
    ).toContain("width");
    expect(
      terminalWindowArrangementReason(
        "cascade",
        { ...stage, height: 200 },
        windows(4),
        "tab-4",
      ),
    ).toContain("height");
  });

  test("handles different window minimums without changing its inputs", () => {
    const input = windows(2);
    input[1] = {
      ...input[1]!,
      minWidth: 700,
      geometry: { left: 200, top: 300, width: 800, height: 500 },
    };
    const snapshot = structuredClone(input);
    const stageSnapshot = structuredClone(stage);
    expect(
      terminalWindowArrangementReason("columns", stage, input, "tab-2"),
    ).toBeNull();
    expect(input).toEqual(snapshot);
    expect(
      terminalWindowArrangementReason("single", stage, input, "tab-2"),
    ).toBeNull();
    expect(input).toEqual(snapshot);
    expect(stage).toEqual(stageSnapshot);
  });
});
