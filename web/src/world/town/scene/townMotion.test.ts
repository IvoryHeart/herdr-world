import { expect, test } from "bun:test";
import { BUS_CHARACTER, moverRun, type MoverRun } from "./townMotion";

const samples = (run: MoverRun, n = 200) =>
  Array.from({ length: n + 1 }, (_, i) => run.at((run.duration * i) / n));

const monotonic = (xs: number[]) =>
  xs.every((x, i) => i === 0 || x >= xs[i - 1]! - 1e-9);

test("a timed arrival covers its road exactly on time and stops there", () => {
  for (const [distance, seconds] of [
    [900, 20],
    [400, 20],
    [1600, 50],
    [900, 3],
  ] as const) {
    const run = moverRun(
      BUS_CHARACTER,
      distance,
      { from: "moving", to: "rest" },
      seconds * 1000,
    );
    expect(run.at(0)).toBe(0);
    expect(run.at(run.duration)).toBeCloseTo(distance, 6);
    expect(run.speedAt(run.duration)).toBeCloseTo(0, 6);
    // It enters moving, and slows down as it reaches the stop.
    expect(run.speedAt(0)).toBeGreaterThan(0);
    expect(run.speedAt(run.duration * 0.99)).toBeLessThan(run.speedAt(0));
    expect(monotonic(samples(run))).toBe(true);
  }
});

test("a timed departure pulls away from rest, speeds up, and is gone on time", () => {
  for (const distance of [300, 900, 1500]) {
    const run = moverRun(
      BUS_CHARACTER,
      distance,
      { from: "rest", to: "moving" },
      6_000,
    );
    expect(run.speedAt(0)).toBeCloseTo(0, 6);
    expect(run.at(run.duration)).toBeCloseTo(distance, 6);
    // Slow at first: the first second covers less than a sixth of the road.
    expect(run.at(1_000)).toBeLessThan(distance / 6);
    expect(run.speedAt(5_000)).toBeGreaterThan(run.speedAt(1_000));
    expect(monotonic(samples(run))).toBe(true);
  }
});

test("an untimed run cruises at the character's speed between its ramps", () => {
  const run = moverRun(BUS_CHARACTER, 2_000, { from: "rest", to: "rest" });
  expect(run.at(run.duration)).toBeCloseTo(2_000, 6);
  expect(run.speedAt(run.duration / 2)).toBeCloseTo(BUS_CHARACTER.speed, 6);
  expect(run.speedAt(0)).toBe(0);
  // A short hop never reaches cruising speed.
  const hop = moverRun(BUS_CHARACTER, 20, { from: "rest", to: "rest" });
  expect(
    Math.max(
      ...samples(hop).map((_, i) => hop.speedAt((hop.duration * i) / 200)),
    ),
  ).toBeLessThan(BUS_CHARACTER.speed);
  expect(hop.at(hop.duration)).toBeCloseTo(20, 6);
});

test("nowhere to go, or no time, is a still mover", () => {
  expect(
    moverRun(BUS_CHARACTER, 0, { from: "rest", to: "rest" }, 5_000).at(2_000),
  ).toBe(0);
  expect(
    moverRun(BUS_CHARACTER, 100, { from: "moving", to: "rest" }, 0).at(0),
  ).toBe(0);
});
