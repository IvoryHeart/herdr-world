import { TOWN_TILE as T } from "./townLayout";
import {
  townBusAt as timetableAt,
  townBusPlan,
  townBusPosition,
  townBusRoute,
  townBusTimetable,
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
  const timetable = townBusTimetable(route, 30_000);
  const arrival = Math.ceil(
    timetable.stops.find((s) => s.id === stop.id)!.arriveMs,
  );
  // Invert the monotone source timetable to enter this street. A bare
  // distance/cruise conversion omits every earlier ramp and dwell.
  const legStart = stop.leg * route.legLength;
  let lo = 0,
    hi = arrival;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (timetableAt(timetable, mid).at < legStart) lo = mid;
    else hi = mid;
  }
  const plan = townBusPlan({
    route,
    tripDurationMs: 30_000,
    riders: [{ entryId: "sample", home: stop.id, joinedMs: 0 }],
  });
  const before = Math.max(
    Math.ceil(hi) + 1,
    // The final brake stays beside the stop that the real chip flew to;
    // earlier cruise can be behind Town chrome on the left.
    Math.floor(arrival - Math.min(1_000, timetable.rampMs / 2)),
  );
  return {
    stop: stop.id,
    width: route.width,
    stops: route.stops.map((s) => s.id),
    position: (elapsed: number) => townBusPosition(plan, elapsed),
    before,
    // Start the refreshed source clock before the checked final-brake window.
    lead: Math.max(Math.ceil(hi) + 1, before - 1_000),
    arrival,
  };
}
