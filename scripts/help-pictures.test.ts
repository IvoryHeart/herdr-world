import { expect, test } from "bun:test";
import { clipAround } from "./help-pictures";

const desktop = { width: 1280, height: 800 };
const crop = { width: 640, height: 400 };

test("a picture centres on its control and stays inside the screen", () => {
  expect(
    clipAround({ x: 600, y: 380, width: 80, height: 40 }, desktop, crop),
  ).toEqual({ x: 320, y: 200, width: 640, height: 400 });
  expect(
    clipAround({ x: 1250, y: 10, width: 20, height: 20 }, desktop, crop),
  ).toEqual({ x: 640, y: 0, width: 640, height: 400 });
  expect(
    clipAround(
      { x: 0, y: 0, width: 10, height: 10 },
      { width: 390, height: 200 },
      crop,
    ),
  ).toEqual({ x: 0, y: 0, width: 390, height: 200 });
});
