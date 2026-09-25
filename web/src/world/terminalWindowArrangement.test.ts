import { describe, expect, test } from "bun:test";
import {
  resolveTerminalWindowArrangement,
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

  test("Grid keeps fifth and later windows floating above tiles with reachable headers", () => {
    const result = placements("grid", 6);
    const [topLeft, , bottomLeft, , firstFloat, secondFloat] = result;
    expect(firstFloat?.geometry.top).toBeGreaterThanOrEqual(
      topLeft!.geometry.top + 40,
    );
    expect(secondFloat!.geometry.top).toBeGreaterThanOrEqual(
      firstFloat!.geometry.top + 40,
    );
    expect(firstFloat!.geometry.top + firstFloat!.geometry.height).toBeLessThan(
      bottomLeft!.geometry.top,
    );
    expect(
      secondFloat!.geometry.top + secondFloat!.geometry.height,
    ).toBeLessThan(bottomLeft!.geometry.top);
    for (const item of result) {
      expect(item.geometry.left).toBeGreaterThanOrEqual(stage.left);
      expect(item.geometry.top).toBeGreaterThanOrEqual(stage.top);
      expect(item.geometry.left + item.geometry.width).toBeLessThanOrEqual(
        stage.left + stage.width,
      );
      expect(item.geometry.top + item.geometry.height).toBeLessThanOrEqual(
        stage.top + stage.height,
      );
    }
  });

  test("Grid uses both free content bands and rejects overflow that cannot expose every title", () => {
    const ten = placements("grid", 10);
    expect(ten).toHaveLength(10);
    expect(ten[7]!.geometry.top).toBeGreaterThan(ten[2]!.geometry.top + 40);
    expect(
      terminalWindowArrangementReason("grid", stage, windows(11), "tab-11"),
    ).toContain("header reachable");
  });

  test("Grid fits mixed floating minimum heights without losing focus order", () => {
    const input = windows(8);
    for (const [index, minHeight] of [280, 390, 340, 340].entries()) {
      input[index + 4] = { ...input[index + 4]!, minHeight };
    }
    const result = resolveTerminalWindowArrangement(
      "grid",
      stage,
      input,
      "tab-8",
    );
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.placements.map(({ id }) => id)).toEqual(
      input.map(({ id }) => id),
    );
    expect(result.placements[4]!.geometry.top).toBeLessThan(514);
    expect(result.placements[5]!.geometry.top).toBeGreaterThan(514);
    expect(result.placements[6]!.geometry.top).toBeLessThan(514);
    expect(result.placements[7]!.geometry.top).toBeGreaterThan(514);
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

  test("unavailable presets return reasons and do not produce partial geometry", () => {
    expect(
      terminalWindowArrangementReason("rows", stage, windows(1), "tab-1"),
    ).toContain("another eligible window");
    expect(
      terminalWindowArrangementReason(
        "columns",
        { ...stage, width: 800 },
        windows(2),
        "tab-2",
      ),
    ).toContain("width");
    expect(
      terminalWindowArrangementReason(
        "rows",
        { ...stage, height: 800 },
        windows(3),
        "tab-3",
      ),
    ).toContain("height");
    expect(
      terminalWindowArrangementReason(
        "grid",
        { ...stage, height: 600 },
        windows(5),
        "tab-5",
      ),
    ).toContain("floating");
    expect(
      terminalWindowArrangementReason(
        "cascade",
        { ...stage, height: 400 },
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
    ).toContain("width");
    expect(input).toEqual(snapshot);
    expect(
      terminalWindowArrangementReason("single", stage, input, "tab-2"),
    ).toBeNull();
    expect(input).toEqual(snapshot);
    expect(stage).toEqual(stageSnapshot);
  });
});
