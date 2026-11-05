import { expect, test } from "bun:test";
import { BIN_DEPARTURE_MS, type BinEntry } from "../../../shared/bin";
import { WorldBinRegistry } from "./bin";
import {
  layoutTown,
  TOWN_TILE as T,
} from "../../../web/src/world/town/townLayout";
import { townBusScene } from "../../../web/src/world/town/scene/townBus";
import {
  BUS_BRAKE,
  townBusRoute,
  townBusSpeed,
} from "../../../web/src/world/town/scene/townBusRoute";
const TOTAL = 30_000 + BIN_DEPARTURE_MS;
let next = 0;
const rider = (_trip: string, remaining_ms: number) => ({
  entry: {
    id: `sample-${++next}`,
    connection_id: "studio",
    connection_generation: 1,
    workspace_id: "w1",
    tab_id: `t-${next}`,
    pane_id: `p-${next}`,
    terminal_id: `terminal-${next}`,
    label: "Agent",
    view: "town",
    trip: "",
    duration_ms: 30_000,
    departure_ms: BIN_DEPARTURE_MS,
    remaining_ms,
  } satisfies BinEntry,
});
const { layout } = layoutTown(
  {
    hosts: [{ key: "host", displayOrder: 0 }],
    rooms: [
      { key: "room", hostKey: "host", order: 0, deskKeys: ["tab-0", "tab-1"] },
    ],
  },
  "wide",
);
const scene = (entries: BinEntry[]) => ({
  scene: townBusScene({
    stops: layout.busStops,
    width: layout.width * T,
    entries,
    homeStop: (entry) =>
      entry.workspace_id === "w2"
        ? layout.busStops.at(-1)!.id
        : layout.busStops[0]!.id,
    remaining: (e) => e.remaining_ms,
    paused: false,
    reducedMotion: false,
  }),
});

test("I2: new observers and remounted layers reconstruct a reset and held trip from service time", () => {
  let now = 0;
  const registry = new WorldBinRegistry({
    epoch: "observers",
    clock: { now: () => now, monotonic: () => now },
    scheduler: { schedule: () => ({ cancel() {} }) },
    commit: async () => {},
    countdown: () => 30,
    publish: () => {},
  });
  const first = rider("", TOTAL).entry;
  registry.add(first);
  const finalFounder = { ...rider("", TOTAL).entry, workspace_id: "w2" };
  registry.add(finalFounder);
  const route = townBusRoute(layout.busStops, layout.width * T);
  const speed = townBusSpeed(route, 30_000);
  const arrival = Math.ceil((route.stops.at(-1)!.at + BUS_BRAKE / 2) / speed);
  now = arrival - 1_000;
  const before = scene(registry.list().entries).scene.buses[0]!;
  expect(before.phase).toBe("arriving");
  registry.add(rider("", TOTAL).entry);
  // Neither observer receives a private starts/seen map.
  const observerA = scene(registry.list().entries).scene.buses[0]!;
  const observerB = scene(structuredClone(registry.list().entries)).scene
    .buses[0]!;
  const pose = (bus: typeof before) => [bus.at, bus.x, bus.y, bus.speed];
  expect([pose(observerA), pose(observerB)]).toEqual([
    pose(before),
    pose(before),
  ]);
  registry.pause();
  now += 60_000;
  expect(scene(registry.list().entries).scene.buses[0]!.x).toBe(before.x);
  registry.resume();
  now += 1_000;
  const arrived = scene(registry.list().entries).scene.buses[0]!;
  expect([arrived.phase, arrived.x]).toEqual(["waiting", arrived.home]);
  registry.add(rider("", TOTAL).entry);
  const remountedParked = scene(registry.list().entries).scene.buses[0]!;
  expect([remountedParked.phase, remountedParked.x]).toEqual([
    "waiting",
    arrived.home,
  ]);
  // Remove the set-off rider at the final stop. Replayed late riders may
  // now wait at F′; both a live scene and a completely fresh observer agree.
  registry.restore(
    registry.list().entries.find((e) => e.pane_id === finalFounder.pane_id)!.id,
  );
  const afterPutBack = registry.list().entries;
  const liveReturned = scene(afterPutBack).scene.buses[0]!;
  const freshReturned = scene(structuredClone(afterPutBack)).scene.buses[0]!;
  expect(pose(freshReturned)).toEqual(pose(liveReturned));
  expect(liveReturned.at).toBeLessThan(arrived.at);
  expect(liveReturned.phase).toBe("waiting");
});
