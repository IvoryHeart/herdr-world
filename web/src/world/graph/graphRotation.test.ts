import { expect, test } from "bun:test";
import { graphQuarterTurns, rotateGraphPoint } from "./graphRotation";

test("quarter turns rotate around the layout center and reverse exactly", () => {
  const center = { x: 12, y: -4 };
  const point = { x: 19, y: -1 };
  expect(rotateGraphPoint(point, center, 1)).toEqual({ x: 9, y: 3 });
  expect(rotateGraphPoint(point, center, -1)).toEqual({ x: 15, y: -11 });
  let turns = 0;
  for (let index = 0; index < 4; index += 1)
    turns = graphQuarterTurns(turns, 1);
  expect(turns).toBe(0);
  expect(graphQuarterTurns(graphQuarterTurns(0, 1), -1)).toBe(0);
  expect(rotateGraphPoint(point, center, turns)).toEqual(point);
});
