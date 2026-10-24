import { expect, test } from "bun:test";
import { boardControlsLayout, type BoardControl } from "./boardControlsLayout";

const widths: Record<BoardControl, number> = {
  work: 72,
  home: 132,
  zoomOut: 44,
  fit: 44,
  zoomIn: 44,
  tidy: 44,
  menu: 44,
};
const layout = (available: number, count = 3, phone = true) =>
  boardControlsLayout({ available, widths, count, phone, gap: 2, chrome: 10 });

test("Work leads; phone Tidy is in overflow and detached notes keep their own action", () => {
  expect(layout(406).inline).toEqual([
    "work",
    "home",
    "zoomOut",
    "fit",
    "zoomIn",
    "menu",
  ]);
  expect(layout(406).overflow).toEqual(["tidy"]);
  expect(layout(366).inline).toEqual([
    "work",
    "zoomOut",
    "fit",
    "zoomIn",
    "menu",
  ]);
  expect(layout(366).overflow).toEqual(["home", "tidy"]);
  expect(layout(800, 0).overflow).toEqual(["home", "tidy"]);
  expect(layout(800, 3, false).inline).toEqual([
    "work",
    "home",
    "zoomOut",
    "fit",
    "zoomIn",
    "tidy",
    "menu",
  ]);
});

test("overflow removes note chip, then Fit, then zoom in/out, while Work always keeps its slot", () => {
  expect(layout(250).overflow).toEqual(["home", "tidy", "fit"]);
  expect(layout(200).overflow).toEqual(["home", "tidy", "fit", "zoomIn"]);
  expect(layout(140).inline).toEqual(["work", "menu"]);
});

test("every action remains reachable exactly once and the single row fits every supported width", () => {
  for (const phone of [false, true])
    for (const count of [0, 1, 128])
      for (let available = 128; available <= 800; available++) {
        const result = boardControlsLayout({
          available,
          widths,
          count,
          phone,
          gap: 2,
          chrome: 10,
        });
        expect(result.inline[0]).toBe("work");
        expect(result.inline[result.inline.length - 1]).toBe("menu");
        const all = [...result.inline, ...result.overflow];
        expect(new Set(all).size).toBe(7);
        expect(all).toHaveLength(7);
        const occupied =
          result.inline.reduce((sum, control) => sum + widths[control], 10) +
          (result.inline.length - 1) * 2;
        expect(occupied).toBeLessThanOrEqual(available);
        if (!count) expect(result.overflow).toContain("home");
      }
});
