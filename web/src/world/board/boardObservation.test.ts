import { expect, test } from "bun:test";
import { fixtureHost, fixtureWorld } from "./boardFixture";
import { boardObservation } from "./boardObservation";

test("Board bypasses deferred live topology on failure, removal or generation retirement", () => {
  const old = fixtureWorld([fixtureHost("a", []), fixtureHost("b", [])]);
  const a = old.hosts[0]!,
    b = old.hosts[1]!;
  for (const hosts of [
    [{ ...a, stale: true, actionable: false }, b],
    [b],
    [{ ...a, generation: 2 }, b],
  ]) {
    const current = fixtureWorld(hosts);
    expect(boardObservation(current, old)).toBe(current);
  }
  const ordinary = fixtureWorld([{ ...a, label: "updated name" }, b]);
  expect(boardObservation(ordinary, old)).toBe(old);
});
