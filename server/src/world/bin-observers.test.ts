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
import { townRoomStops } from "../../../web/src/world/town/townBusStop";
const TOTAL = 30_000 + BIN_DEPARTURE_MS;

test("setting changes on a boarding reset preserve real room pickup, fixed timetable and departure from F", () => {
  const { layout } = layoutTown(
    {
      hosts: [{ key: "synthetic", displayOrder: 0 }],
      rooms: [
        { key: "room", hostKey: "synthetic", order: 0, deskKeys: ["a", "b"] },
      ],
    },
    "wide",
  );
  const home = townRoomStops(layout).get("room")!;
  const route = townBusRoute(layout.busStops, layout.width * T);
  const final = route.stops.find((stop) => stop.id === home)!;
  for (const [original, selected] of [
    [120, 10],
    [10, 120],
  ] as const) {
    let now = 0;
    let setting: 10 | 120 = original;
    const committed: BinEntry[][] = [];
    const registry = new WorldBinRegistry({
      epoch: `settings-${original}`,
      clock: { now: () => now, monotonic: () => now },
      scheduler: { schedule: () => ({ cancel() {} }) },
      commit: async (entries) => {
        committed.push([...entries]);
      },
      countdown: () => setting,
      publish: () => {},
    });
    const drop = (id: string) => ({
      connection_id: "synthetic",
      connection_generation: 1,
      workspace_id: "room",
      tab_id: id,
      pane_id: id,
      terminal_id: id,
      label: id,
      view: "town" as const,
    });
    registry.add(drop("a"));
    const table = townBusTimetable(route, original * 1_000);
    const pickup = table.stops.find((s) => s.id === home)!;
    now = 1_000;
    setting = selected;
    const joined = registry.add(drop("b"));
    expect(joined.entries.map((e) => e.remaining_ms)).toEqual([
      126_000, 126_000,
    ]);
    expect(joined.entries.map((e) => e.duration_ms)).toEqual([
      120_000, 120_000,
    ]);
    expect(joined.entries.map((e) => e.trip_duration_ms)).toEqual([
      original * 1_000,
      original * 1_000,
    ]);
    const beforePickup = pickup.arriveMs - table.rampMs / 2;
    expect(beforePickup).toBeGreaterThan(1_000);
    const departureAt = 121_000;
    const times = [
      11_001,
      beforePickup,
      pickup.arriveMs + 1,
      departureAt,
      departureAt + 1,
    ].sort((a, b) => a - b);
    for (const time of times) {
      now = time;
      const entries = registry.list().entries;
      expect(
        entries.every((e) => e.trip_duration_ms === original * 1_000),
      ).toBe(true);
      const scene = townBusScene({
        stops: layout.busStops,
        width: layout.width * T,
        entries,
        homeStop: (entry) => townRoomStops(layout).get(entry.workspace_id)!,
        remaining: (entry) => entry.remaining_ms,
        paused: false,
        reducedMotion: false,
      });
      const bus = scene.buses[0]!;
      if (time === beforePickup || (time === 11_001 && original === 120)) {
        expect(scene.waiting).toHaveLength(2);
        expect(scene.buses.flatMap((b) => b.riders)).toEqual([]);
        expect(bus.phase).toBe("arriving");
        expect(bus.at).toBeLessThan(final.at);
        if (time === 11_001) expect(bus.at).toBeLessThan(route.stops[0]!.at);
      } else if (time === departureAt + 1) {
        expect(bus.phase).toBe("departing");
        expect(bus.at).toBe(final.at);
        expect(bus.y).toBe(final.busY);
        expect(bus.x).toBeGreaterThanOrEqual(final.busX);
        expect(bus.x - final.busX).toBeLessThan(1);
      } else {
        expect(bus.phase).toBe("waiting");
        expect(bus.at).toBe(final.at);
        expect(scene.waiting).toEqual([]);
        expect(bus.riders).toHaveLength(2);
        expect(bus.doorsOpen).toBe(true);
      }
      expect(committed).toEqual([]);
    }
    expect(
      townBusTimetable(route, joined.entries[0]!.trip_duration_ms!),
    ).toEqual(table);
    for (const entry of registry.list().entries) registry.restore(entry.id);
    const fresh = registry.add(drop("fresh")).entries[0]!;
    expect(fresh.trip_duration_ms).toBe(selected * 1_000);
    expect(fresh.duration_ms).toBe(selected * 1_000);
    expect(fresh.remaining_ms).toBe(selected * 1_000 + BIN_DEPARTURE_MS);
    expect(fresh.trip_elapsed_ms).toBe(0);
    registry.dispose();
  }
});
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
