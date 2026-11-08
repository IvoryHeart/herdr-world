import { expect, test } from "bun:test";
import { boardControlsLayout, type BoardControl } from "./boardControlsLayout";

const widths: Record<BoardControl, number> = {
  work: 72,
  lens: 76,
  next: 64,
  home: 132,
  zoomOut: 44,
  fit: 44,
  zoomIn: 44,
  tidy: 44,
  menu: 44,
};
const layout = (available: number, count = 3, phone = true) =>
  boardControlsLayout({ available, widths, count, phone, gap: 2, chrome: 10 });

test("Work, Lenses and Next lead; phone Tidy is in overflow and detached notes keep their own action", () => {
  expect(layout(556).inline).toEqual([
    "work",
    "lens",
    "next",
    "home",
    "zoomOut",
    "fit",
    "zoomIn",
    "menu",
  ]);
  expect(layout(556).overflow).toEqual(["tidy"]);
  expect(layout(444).inline).toEqual([
    "work",
    "lens",
    "next",
    "zoomOut",
    "fit",
    "zoomIn",
    "menu",
  ]);
  expect(layout(444).overflow).toEqual(["home", "tidy"]);
  expect(layout(800, 0).overflow).toEqual(["home", "tidy"]);
  expect(layout(800, 3, false).inline).toEqual([
    "work",
    "lens",
    "next",
    "home",
    "zoomOut",
    "fit",
    "zoomIn",
    "tidy",
    "menu",
  ]);
});

test("overflow removes note chip, then Lenses, then Fit, then zoom in/out, while Work always keeps its slot", () => {
  // Without Lenses, the phone row keeps the controls it always had.
  expect(layout(366).inline).toEqual([
    "work",
    "next",
    "zoomOut",
    "fit",
    "zoomIn",
    "menu",
  ]);
  expect(layout(366).overflow).toEqual(["home", "lens", "tidy"]);
  expect(layout(250).overflow).toEqual([
    "home",
    "lens",
    "tidy",
    "fit",
    "zoomIn",
  ]);
  expect(layout(200).overflow).toEqual([
    "home",
    "lens",
    "tidy",
    "fit",
    "zoomIn",
    "zoomOut",
  ]);
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
        expect(new Set(all).size).toBe(9);
        expect(all).toHaveLength(9);
        const occupied =
          result.inline.reduce((sum, control) => sum + widths[control], 10) +
          (result.inline.length - 1) * 2;
        expect(occupied).toBeLessThanOrEqual(available);
        if (!count) expect(result.overflow).toContain("home");
      }
});
