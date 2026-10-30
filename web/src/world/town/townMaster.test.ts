import { expect, test } from "bun:test";
import { findTownMaster } from "./townMaster";

const entry = (key: string, displayLabel: string, agentName?: string) => ({
  agent: { key, displayLabel, agentName },
});

test("native names take priority over display labels, retaining first-match order", async () => {
  const label = entry("label", "FirstMate");
  const native = entry("native", "Ari", "FIRSTMATE");
  expect(
    await findTownMaster(
      [label, native, entry("later", "Lee", "firstmate")],
      " FirstMate ",
    ),
  ).toBe(native.agent);
});

test("a display-label fallback waits for later native names across batches", async () => {
  const label = entry("label", "FirstMate");
  const native = entry("native", "Ari", "firstmate");
  const roster = [
    label,
    ...Array.from({ length: 1000 }, (_, i) =>
      entry(`other-${i}`, "Worker", "worker"),
    ),
    native,
  ];
  let turns = 0;
  expect(
    await findTownMaster(
      roster,
      "firstmate",
      () => true,
      async () => {
        turns += 1;
      },
    ),
  ).toBe(native.agent);
  expect(turns).toBeGreaterThan(0);
  expect(
    await findTownMaster(
      roster.slice(0, -1),
      "firstmate",
      () => true,
      async () => {},
    ),
  ).toBe(label.agent);
});

test("large missing-name searches yield and abandon superseded rosters", async () => {
  let read = 0;
  const worker = entry("worker", "Worker", "worker").agent;
  const roster = Array.from({ length: 10_000 }, () => ({
    get agent() {
      read += 1;
      return worker;
    },
  }));
  const gate = Promise.withResolvers<void>();
  let current = true;
  const result = findTownMaster(
    roster,
    "firstmate",
    () => current,
    () => gate.promise,
  );
  expect(read).toBeGreaterThan(0);
  expect(read).toBeLessThan(roster.length);
  const before = read;
  current = false;
  gate.resolve();
  expect(await result).toBeUndefined();
  expect(read).toBe(before);
});

test("empty or already retired lookups never read the roster", async () => {
  const unused = new Proxy([], {
    get() {
      throw new Error("read an unused roster");
    },
  });
  expect(await findTownMaster(unused, " ")).toBeUndefined();
  expect(
    await findTownMaster(unused, "firstmate", () => false),
  ).toBeUndefined();
});
