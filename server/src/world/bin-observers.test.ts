import { expect, test } from "bun:test";
import { BIN_DEPARTURE_MS, type BinEntry } from "../../../shared/bin";
import { WorldBinRegistry } from "./bin";
import {
  layoutTown,
  TOWN_TILE as T,
} from "../../../web/src/world/town/townLayout";
import { townBusScene } from "../../../web/src/world/town/scene/townBus";
import {
  townBusRoute,
  townBusTimetable,
} from "../../../web/src/world/town/scene/townBusRoute";
import {
  townBusChipStop,
  soonestTownBus,
} from "../../../web/src/world/town/townBusChip";
import { STOP_W } from "../../../web/src/world/town/townBusGeometry";
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
  const arrival = Math.ceil(
    townBusTimetable(route, 30_000).stops.at(-1)!.arriveMs,
  );
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

test("the chip follows the departure whose clock it displays when trips overlap", () => {
  let now = 0;
  const registry = new WorldBinRegistry({
    epoch: "synthetic-chip",
    clock: { now: () => now, monotonic: () => now },
    scheduler: { schedule: () => ({ cancel() {} }) },
    commit: async () => {},
    countdown: () => 30,
    publish: () => {},
  });
  const target = (id: string) => ({
    connection_id: "synthetic",
    connection_generation: 1,
    workspace_id: "workspace",
    tab_id: id,
    pane_id: id,
    terminal_id: id,
    label: id,
    view: "town" as const,
  });
  registry.add(target("a"));
  now = 31_000;
  registry.add(target("b"));
  const entries = registry.list().entries;
  expect(entries.map((e) => e.remaining_ms)).toEqual([5_000, 36_000]);
  expect(new Set(entries.map((e) => e.trip)).size).toBe(2);
  const { layout } = layoutTown(
    {
      hosts: [{ key: "host", displayOrder: 0 }],
      rooms: [{ key: "room", hostKey: "host", order: 0, deskKeys: ["a", "b"] }],
    },
    "wide",
  );
  const remaining = (e: (typeof entries)[number]) => e.remaining_ms;
  const scene = townBusScene({
    stops: layout.busStops,
    width: layout.width * 16,
    entries,
    homeStop: (e) =>
      e.tab_id === "a" ? layout.busStops[0]!.id : layout.busStops.at(-1)!.id,
    remaining,
    paused: false,
    reducedMotion: false,
  });
  const selected = scene.stops.find(
    (s) => s.id === scene.stopOf.get(entries[0]!.id),
  )!;
  expect(scene.stopOf.get(entries[0]!.id)).not.toBe(
    scene.stopOf.get(entries[1]!.id),
  );
  expect(soonestTownBus(entries, remaining)).toMatchObject({
    trip: entries[0]!.trip,
    remaining: 0,
    leaving: true,
  });
  expect(townBusChipStop(layout, scene, entries, remaining)).toEqual({
    pole: selected.box.x + STOP_W / 2,
    foot: selected.box.y + selected.box.h,
  });
  const single = [entries[1]!];
  const b = scene.stops.find((s) => s.id === scene.stopOf.get(single[0]!.id))!;
  expect(townBusChipStop(layout, scene, single, remaining)).toEqual({
    pole: b.box.x + STOP_W / 2,
    foot: b.box.y + b.box.h,
  });
  expect(soonestTownBus([], remaining)).toBeNull();
  expect(townBusChipStop(layout, scene, [], remaining)).toEqual({
    pole: layout.busStop.x * 16 + 8,
    foot: layout.busStop.y * 16 + 16,
  });
});
