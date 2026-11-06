import { BIN_BUS_DRIVE_MS, type BinBus } from "../../../../shared/bin";
import { type TownLayout, type TownPoint, TownGround } from "./townLayout";

export type TownBusStop = TownPoint & {
  key: string;
  roadX: number;
  roadY: number;
};
export type TownBusRoute = {
  stops: TownBusStop[];
  points: TownPoint[];
  length: number;
  pickups: ReadonlyMap<string, number>;
};
export type TownTransit = {
  waiting: ReadonlyMap<string, TownBusStop>;
  riders: ReadonlySet<string>;
  departed?: ReadonlySet<string>;
  route: TownBusRoute;
  bus?: BinBus;
  readAt: number;
};
const distance = (a: TownPoint, b: TownPoint) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
/** Road intersections, joined along actual roads; a depth-first tour visits every stop. */
export function townBusRoute(layout: TownLayout): TownBusRoute {
  const nodes = new Map<string, TownBusStop>();
  for (const vertical of layout.verticalRoads)
    for (const row of layout.roads)
      if (row >= vertical.y0 - 5 && row <= vertical.y1) {
        const roadX = vertical.x + 2,
          roadY = row + 2;
        const key = `${roadX},${roadY}`;
        nodes.set(key, { key, roadX, roadY, x: vertical.x, y: row });
      }
  const stops = [...nodes.values()].sort(
    (a, b) => a.roadY - b.roadY || a.roadX - b.roadX,
  );
  const edges = new Map(stops.map((stop) => [stop.key, new Set<string>()]));
  const link = (a: TownBusStop, b: TownBusStop) => {
    edges.get(a.key)!.add(b.key);
    edges.get(b.key)!.add(a.key);
  };
  for (const row of layout.roads) {
    const onRow = stops.filter((stop) => stop.roadY === row + 2);
    for (let i = 1; i < onRow.length; i++) link(onRow[i - 1]!, onRow[i]!);
  }
  for (const vertical of layout.verticalRoads) {
    const onRoad = stops.filter(
      (stop) =>
        stop.roadX === vertical.x + 2 &&
        stop.roadY >= vertical.y0 - 3 &&
        stop.roadY <= vertical.y1 + 2,
    );
    for (let i = 1; i < onRoad.length; i++) link(onRoad[i - 1]!, onRoad[i]!);
  }
  const first = stops[0];
  if (!first) return { stops, points: [], length: 0, pickups: new Map() };
  const points: TownPoint[] = [{ x: -4, y: first.roadY }];
  const seen = new Set<string>();
  const pickups = new Map<string, number>();
  let length = 0;
  const add = (point: TownPoint) => {
    length += distance(points[points.length - 1]!, point);
    points.push(point);
  };
  const visit = (stop: TownBusStop) => {
    seen.add(stop.key);
    add({ x: stop.roadX, y: stop.roadY });
    pickups.set(stop.key, length);
    for (const key of edges.get(stop.key)!) {
      if (seen.has(key)) continue;
      visit(nodes.get(key)!);
      add({ x: stop.roadX, y: stop.roadY });
    }
  };
  visit(first);
  add({ x: -4, y: first.roadY });
  return { stops, points, length, pickups };
}
export function nearestTownStop(route: TownBusRoute, point: TownPoint) {
  return route.stops.reduce<TownBusStop | null>(
    (nearest, stop) =>
      !nearest || distance(stop, point) < distance(nearest, point)
        ? stop
        : nearest,
    null,
  );
}
export function townBusProgress(transit: TownTransit, now: number) {
  return transit.bus?.driving
    ? Math.min(
        1,
        Math.max(
          0,
          (transit.bus.elapsed_ms + Math.max(0, now - transit.readAt)) /
            BIN_BUS_DRIVE_MS,
        ),
      )
    : 0;
}
export function townRiderHidden(
  key: string,
  transit: TownTransit | undefined,
  now: number,
) {
  if (transit?.departed?.has(key)) return true;
  const stop = transit?.waiting.get(key);
  return !!(
    transit &&
    stop &&
    transit.riders.has(key) &&
    townBusProgress(transit, now) * transit.route.length >=
      (transit.route.pickups.get(stop.key) ?? Infinity)
  );
}
/** Outdoor tile walk: front-door portals are handled by TownActors. */
export function townOutdoorPath(
  layout: TownLayout,
  from: TownPoint,
  to: TownPoint,
): [number, number][] {
  const { width, height, ground } = layout;
  const start = from.y * width + from.x,
    end = to.y * width + to.x;
  const came = new Int32Array(width * height).fill(-1);
  if (start < 0 || end < 0 || start >= came.length || end >= came.length)
    return [];
  const queue = [start];
  came[start] = start;
  for (let i = 0; i < queue.length && came[end] === -1; i++) {
    const at = queue[i]!,
      x = at % width,
      y = Math.floor(at / width);
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (nx! < 0 || ny! < 0 || nx! >= width || ny! >= height) continue;
      const next = ny! * width + nx!;
      if (
        came[next] !== -1 ||
        ground[next] === TownGround.building ||
        ground[next] === TownGround.facade ||
        ground[next] === TownGround.lot
      )
        continue;
      came[next] = at;
      queue.push(next);
    }
  }
  if (came[end] === -1) return [];
  const path: [number, number][] = [];
  for (let at = end; at !== start; at = came[at]!)
    path.push([at % width, Math.floor(at / width)]);
  return path.reverse();
}
