import { expect, test } from "bun:test";
import { townHelpRevealPoint } from "./useTownHelpReveal";

// A phone's Town: 390 × 844 with the camera centred on (500, 400) at zoom 2.
const camera = {
  viewport: {
    width: 390,
    height: 844,
    inset: { left: 0, right: 0, top: 60, bottom: 0 },
  },
  toWorld: (sx: number, sy: number) => ({
    x: 500 + (sx - 195) / 2,
    y: 400 + (sy - 422) / 2,
  }),
};

test("a Town control already in view is left where it is", () => {
  expect(
    townHelpRevealPoint(camera, {
      left: 150,
      top: 400,
      right: 240,
      bottom: 440,
    }),
  ).toBeNull();
});

test("a Town control below the camera is centred, as the camera flies there", () => {
  // The Apartments sign under a phone's first view (#1150).
  expect(
    townHelpRevealPoint(camera, {
      left: 150,
      top: 1100,
      right: 240,
      bottom: 1140,
    }),
  ).toEqual({ x: 500, y: 400 + (1120 - 422) / 2 });
});

test("a control under the top chrome counts as out of view", () => {
  expect(
    townHelpRevealPoint(camera, {
      left: 150,
      top: 70,
      right: 240,
      bottom: 100,
    }),
  ).not.toBeNull();
});
