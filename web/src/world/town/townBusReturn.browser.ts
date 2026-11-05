import { BIN_DEPARTURE_MS, type BinEntry } from "../../../../shared/bin";
import { TownBusLayer, BUS_FADE_MS } from "./townBusLayer";
import { BUS_H, BUS_W } from "./townBusGeometry";
import { townRoomStops } from "./townBusStop";
import { BUS_BRAKE, townBusRoute, townBusSpeed } from "./scene/townBusRoute";
import { layoutTown } from "./townLayout";

/** Exercise the real Pixi layer on an injected observation clock in Chrome. */
export function checkTownBusReturnLayer(
  check: (condition: boolean, message: string) => void,
) {
  return [false, true].map((orphan) => checkReturnLayer(check, orphan));
}

function checkReturnLayer(
  check: (condition: boolean, message: string) => void,
  orphan: boolean,
) {
  const { layout } = layoutTown(
    {
      hosts: [0, 1, 2].map((i) => ({ key: `host-${i}`, displayOrder: i })),
      rooms: [0, 1, 2].flatMap((i) =>
        [0, 1].map((j) => ({
          key: `room-${i}-${j}`,
          hostKey: `host-${i}`,
          order: j,
          deskKeys: [`desk-${i}-${j}`],
        })),
      ),
    },
    "wide",
  );
  const rooms = [...townRoomStops(layout)].sort(
    (a, b) =>
      layout.busStops.find((s) => s.id === a[1])!.order -
      layout.busStops.find((s) => s.id === b[1])!.order,
  );
  const first = rooms[0]!,
    last = rooms[rooms.length - 1]!;
  if (first[1] === last[1])
    throw new Error("3prime needs two distinct nearest room stops");
  const entry = (id: string): BinEntry => ({
    id,
    connection_id: "synthetic",
    connection_generation: 1,
    workspace_id: id,
    tab_id: id,
    pane_id: id,
    terminal_id: id,
    label: id,
    view: "town",
    trip: "return-trip",
    duration_ms: 30_000,
    departure_ms: BIN_DEPARTURE_MS,
    remaining_ms: 16_000,
    trip_duration_ms: 30_000,
    trip_elapsed_ms: 30_000,
    trip_joined_ms: 0,
  });
  const route = townBusRoute(layout.busStops, layout.width * 16);
  const finalAt = route.stops.find((s) => s.id === last[1])!.at;
  const joined = (finalAt + BUS_BRAKE / 2) / townBusSpeed(route, 30_000) + 500;
  const earlier = { ...entry("earlier"), trip_joined_ms: orphan ? joined : 0 };
  let entries = [entry("final"), earlier];
  let now = 0;
  const make = () =>
    new TownBusLayer({
      layout: () => layout,
      entries: () => entries,
      remaining: (e) => e.remaining_ms,
      elapsed: (e) => e.trip_elapsed_ms!,
      paused: () => true,
      agent: () => undefined,
      roomOf: (id) => (id === "earlier" ? first[0] : last[0]),
      now: () => now,
    });
  const layer = make(),
    fresh = make();
  const sprites = () =>
    layer.container.children
      .filter((s) => s.visible && s.width === BUS_W && s.height === BUS_H)
      .map((s) => ({ x: s.x, y: s.y, alpha: s.alpha }));
  const pose = (value: TownBusLayer) =>
    value.scene!.buses.map((b) => ({
      key: b.key,
      x: b.x,
      y: b.y,
      at: b.at,
      phase: b.phase,
      riders: b.riders.map((r) => r.entryId),
    }));
  const observations: unknown[] = [];
  const sample = () =>
    observations.push({ now, pose: pose(layer), sprites: sprites() });
  try {
    layer.update(false);
    const old = layer.scene!.buses[0]!;
    check(
      old.phase === "waiting",
      "3prime: initial bus must wait at the final room stop",
    );
    if (orphan)
      check(
        layer.scene!.stopOf.get("earlier") === last[1] &&
          old.riders.some((r) => r.entryId === "earlier"),
        "orphan: late rider must board the founder's waiting bus before Put back",
      );
    entries = entries.filter((e) => e.id === "earlier");
    layer.update(false);
    fresh.update(false);
    if (orphan)
      check(
        layer.scene!.stopOf.get("earlier") === first[1] &&
          layer.scene!.buses[0]?.phase === "waiting" &&
          layer.scene!.buses[0]?.riders.some((r) => r.entryId === "earlier"),
        "orphan: founder Put back must return the bus and boarded rider to its own home",
      );
    const returned = layer.scene!.buses[0]!;
    check(
      returned.at < old.at,
      "3prime: final Put back must return to earlier Fprime",
    );
    check(
      JSON.stringify(pose(layer)) === JSON.stringify(pose(fresh)),
      "3prime: returned scene differs from remount/always-Fprime",
    );
    const alpha = () =>
      sprites().find(
        (s) => s.x === Math.round(returned.x) && s.y === returned.y,
      )?.alpha;
    sample();
    check(alpha() === 0, "3prime: returning bus must start hidden at Fprime");
    now = BUS_FADE_MS / 2;
    layer.update(false);
    sample();
    check(alpha() === 0, "3prime: bus faded in before the old leaver left");
    now = BIN_DEPARTURE_MS;
    layer.update(false);
    sample();
    check(
      sprites().length === 1 && alpha() === 0,
      "3prime: fade must start after the old leaver ends",
    );
    now += BUS_FADE_MS / 2;
    layer.update(false);
    sample();
    check(
      (alpha() ?? -1) > 0 && (alpha() ?? 2) < 1,
      "3prime: returned bus has no intermediate fade",
    );
    now += BUS_FADE_MS / 2;
    layer.update(false);
    sample();
    check(
      alpha() === 1 &&
        JSON.stringify(pose(layer)) === JSON.stringify(pose(fresh)),
      "3prime: live fade end differs from remount state",
    );
    entries = [];
    layer.update(false);
    check(
      layer.scene!.buses.length === 0 && sprites().length === 1,
      "3prime: zero riders must use the existing emptied leaver",
    );
    now += BIN_DEPARTURE_MS;
    layer.update(false);
    check(sprites().length === 0, "3prime: emptied bus did not leave the map");
  } finally {
    layer.destroy();
    fresh.destroy();
  }
  return observations;
}
