import { TOWN_TILE as T } from "./townLayout";
import {
  BUS_BRAKE,
  townBusPlan,
  townBusPosition,
  townBusRoute,
  townBusSpeed,
} from "./scene/townBusRoute";

/** Pick an approach/arrival sample from the actual rendered stop geometry. */
export function townBusClockSample(host: HTMLElement) {
  const stops = [...host.querySelectorAll<HTMLElement>(".town-bus-stop")].map(
    (e, order) => {
      const [road, x] = e.dataset.stop!.split(":").map(Number);
      return {
        id: e.dataset.stop!,
        order,
        main: e.dataset.main === "true",
        road: road!,
        x: x!,
        y: road!,
        queueStart: 1,
      };
    },
  );
  const rider = host.querySelector<HTMLElement>(".town-bus-rider");
  if (!rider) throw new Error("bus clock sample needs its waiting rider");
  const route = townBusRoute(
    stops,
    window.__HERDR_TOWN_RENDERER__!.layout!.width * T,
  );
  const stop = route.stops.find(
    (s) =>
      Math.abs(s.poleX - (Number.parseFloat(rider.style.left) + 16)) < 0.01 &&
      Math.abs(s.footY - (Number.parseFloat(rider.style.top) + 4)) < 0.01,
  );
  if (!stop) throw new Error("waiting rider does not identify a rendered stop");
  const speed = townBusSpeed(route, 30_000);
  const arrival = Math.ceil((stop.at + BUS_BRAKE / 2) / speed);
  const plan = townBusPlan({
    route,
    tripDurationMs: 30_000,
    riders: [{ entryId: "sample", home: stop.id, joinedMs: 0 }],
  });
  return {
    stop: stop.id,
    width: route.width,
    stops: route.stops.map((s) => s.id),
    position: (elapsed: number) => townBusPosition(plan, elapsed),
    before: Math.max(
      Math.ceil((stop.leg * route.legLength) / speed) + 1,
      arrival - 1_000,
    ),
    arrival,
  };
}
