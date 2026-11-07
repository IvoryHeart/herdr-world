import { expect, test } from "bun:test";
import { OwnerPresenceClock } from "./presence";

test("each sighting returns the previous one by the service's clock", () => {
  let now = 1_000;
  const clock = new OwnerPresenceClock(() => now);
  expect(clock.seen()).toEqual({ previous: null, now: 1_000 });
  now = 61_000;
  expect(clock.seen()).toEqual({ previous: 1_000, now: 61_000 });
  // A clock step backwards never moves the last sighting back.
  now = 5_000;
  expect(clock.seen()).toEqual({ previous: 61_000, now: 5_000 });
  now = 70_000;
  expect(clock.seen()).toEqual({ previous: 61_000, now: 70_000 });
});
