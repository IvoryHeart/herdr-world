import { afterEach, expect, test } from "bun:test";
import type { TownModel } from "./townModel";
import {
  TOWN_BUS_DEMO_TRIP_MS,
  TOWN_BUS_DEMO_WAIT_MS,
  resetTownBusDemo,
  townBusDemoBin,
  townBusDemoNext,
  townBusDemoStart,
} from "./townBusDemo";

const agent = (key: string, roomKey: string) => ({
  key,
  roomKey,
  agentName: key,
  displayLabel: key,
  currentPaneRef: { connectionId: "c1", generation: 1, nativeId: `p-${key}` },
});
const model = {
  agents: new Map(
    [
      agent("a1", "r1"),
      agent("a2", "r1"),
      agent("b1", "r2"),
      agent("c1", "r3"),
      agent("d1", "r4"),
      agent("e1", "r5"),
    ].map((item) => [item.key, item]),
  ),
} as unknown as Pick<TownModel, "agents">;

afterEach(() => {
  resetTownBusDemo();
  delete (globalThis as { location?: unknown }).location;
  delete (globalThis as { history?: unknown }).history;
});

test("the demo bins one agent from each of four rooms, then the bus takes them and they move in", () => {
  const ids = (bin: ReturnType<typeof townBusDemoBin>) =>
    bin.entries.map((entry) => entry.pane_id);
  const waiting = townBusDemoBin(model, 1_000, 1_000);
  expect(ids(waiting)).toEqual(["p-a1", "p-b1", "p-c1", "p-d1"]);
  expect(waiting.entries.every((entry) => !entry.riding)).toBe(true);
  expect(waiting.bus.elapsed_ms).toBeNull();
  expect(waiting.bus.next_ms).toBe(TOWN_BUS_DEMO_WAIT_MS);
  const riding = townBusDemoBin(
    model,
    1_000,
    1_000 + TOWN_BUS_DEMO_WAIT_MS + 500,
  );
  expect(riding.entries.every((entry) => entry.riding)).toBe(true);
  expect(riding.bus).toMatchObject({
    elapsed_ms: 500,
    trip_ms: TOWN_BUS_DEMO_TRIP_MS,
    trip: 1,
  });
  const over = townBusDemoBin(
    model,
    1_000,
    1_000 + TOWN_BUS_DEMO_WAIT_MS + TOWN_BUS_DEMO_TRIP_MS,
  );
  expect(over.entries).toEqual([]);
  expect(over.closing.map((entry) => entry.pane_id)).toEqual(ids(waiting));
  expect(over.bus.elapsed_ms).toBeNull();
  // It changes as the bus comes and as its trip ends, then never again.
  expect(townBusDemoNext(0, 0)).toBe(TOWN_BUS_DEMO_WAIT_MS);
  expect(townBusDemoNext(0, TOWN_BUS_DEMO_WAIT_MS)).toBe(
    TOWN_BUS_DEMO_WAIT_MS + TOWN_BUS_DEMO_TRIP_MS,
  );
  expect(
    townBusDemoNext(0, TOWN_BUS_DEMO_WAIT_MS + TOWN_BUS_DEMO_TRIP_MS),
  ).toBeNull();
});

test("the ?townBusDemo switch is read once and dropped from the address at once", () => {
  const replaced: string[] = [];
  Object.assign(globalThis, {
    location: { href: "http://world.example/?townBusDemo&view=town" },
    history: {
      state: null,
      replaceState: (_: unknown, __: string, url: URL) =>
        replaced.push(String(url)),
    },
  });
  const start = townBusDemoStart();
  expect(start).not.toBeNull();
  expect(replaced).toEqual(["http://world.example/?view=town"]);
  // Read again, the same start; nothing more is replaced.
  expect(townBusDemoStart()).toBe(start);
  expect(replaced).toHaveLength(1);
  resetTownBusDemo();
  (globalThis as { location: { href: string } }).location.href =
    "http://world.example/?view=town";
  expect(townBusDemoStart()).toBeNull();
});
