import { expect, test } from "bun:test";
import { BIN_DEPARTURE_MS, type BinEntry } from "../../../shared/bin";
import { WorldBinRegistry } from "./bin";
import {
  layoutTown,
  TOWN_TILE as T,
} from "../../../web/src/world/town/townLayout";
import { townBusScene } from "../../../web/src/world/town/scene/townBus";
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
    stop: layout.busStop,
    width: layout.width * T,
    entries,
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
  now = 19_000;
  const before = scene(registry.list().entries).scene.buses[0]!;
  registry.add(rider("", TOTAL).entry);
  // Neither observer receives a private starts/seen map.
  const observerA = scene(registry.list().entries).scene.buses[0]!;
  const observerB = scene(structuredClone(registry.list().entries)).scene
    .buses[0]!;
  expect([observerA.x, observerB.x]).toEqual([before.x, before.x]);
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
});
