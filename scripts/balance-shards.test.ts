import { expect, test } from "bun:test";
import { balanceShards } from "./balance-shards";
import { worldBrowserSuites } from "./world-browser-suites";
import models from "./verification-timings.json";
import { verificationModels } from "../quint/models";
import { townCanvasCases } from "../web/src/world/town/TownCanvas.cases";

test("longest-first assignment partitions cases deterministically by measured work", () => {
  expect(
    balanceShards(
      ["a", "b", "c", "d", "e"],
      { a: 8, b: 7, c: 3, d: 2, e: 1 },
      2,
    ),
  ).toEqual([
    ["a", "d", "e"],
    ["b", "c"],
  ]);
  for (const count of [0, -1, 1.5, NaN])
    expect(() => balanceShards(["a"], { a: 1 }, count)).toThrow();
  expect(() => balanceShards(["a", "a"], { a: 1 }, 2)).toThrow();
  for (const bad of [0, -1, NaN, Infinity])
    expect(() => balanceShards(["a"], { a: bad }, 2)).toThrow();
});

test("every maintained model has a measured weight and each Town group is registered", () => {
  expect(Object.keys(models.seconds).sort()).toEqual(
    [...verificationModels].sort(),
  );
  for (const group of Object.keys(townCanvasCases)) {
    const name =
      group === "baseline" ? "town/TownCanvas" : `town/TownCanvas.${group}`;
    expect(worldBrowserSuites).toContain(`web/src/world/${name}.test.ts`);
  }
});

test("Town partitions retain the original cases plus reception, core desk and bus proofs", () => {
  const cases = Object.values(townCanvasCases).flat();
  const original = [
    [1440, 900, "typical", 0],
    [390, 900, "typical", 0],
    [390, 844, "recovery", 0],
    [1440, 900, "recovery", 0],
    [1440, 900, "max", 0],
    [390, 844, "extended", 0],
    [960, 1080, "extended", 0],
    [1440, 900, "extended", 0],
    [1080, 1920, "extended-controls", 0],
    [1080, 1920, "extended-moves", 0],
    [1080, 1920, "extended-reflow", 0],
    [1080, 1920, "extended", 300],
    [390, 844, "incremental", 0],
    [1440, 900, "plates", 0],
    [390, 844, "plates", 0],
    [390, 844, "fold", 0],
    [960, 1080, "fold", 0],
    [1440, 900, "fold", 0],
    [1080, 1920, "fold", 0],
    [2560, 1440, "fold", 0],
    [390, 844, "fold-protected", 0],
    [390, 844, "protected", 0],
    [390, 844, "navigation", 0],
    [1440, 900, "navigation", 0],
    // Pressing each place's building opens one window frame (#1170).
    [1440, 900, "places", 0],
    [390, 844, "places", 0],
    // The reception filter's visibility check (#501), at phone and desktop width.
    [390, 844, "reception", 0],
    [1440, 900, "reception", 0],
    // Tapping herdr-core desks (#1006), at phone and desktop width.
    [412, 915, "core", 0],
    [1440, 900, "core", 0],
    // Full bus trips have independent deadlines at both original typical widths.
    [1440, 900, "bus", 0],
    [390, 900, "bus", 0],
  ];
  expect(cases.map((item) => JSON.stringify(item)).sort()).toEqual(
    original.map((item) => JSON.stringify(item)).sort(),
  );
});
