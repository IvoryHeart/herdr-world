import { expect, test } from "bun:test";
import { graphPanStrips } from "./graphPanStrips";

test("pan reuse repaints exposed strips and rejects resampled translations", () => {
  expect(graphPanStrips(200, 100, 10, -5, 1)).toEqual([
    { x: 0, y: 0, width: 10, height: 100 },
    { x: 0, y: 95, width: 200, height: 5 },
  ]);
  expect(graphPanStrips(200, 100, 0, 0, 2)).toEqual([]);
  expect(graphPanStrips(200, 100, 0.5, 0, 1)).toBeNull();
  expect(graphPanStrips(200, 100, 0.5, 0, 2)).toHaveLength(1);
  expect(graphPanStrips(200, 100, 200, 0, 2)).toBeNull();
});
