import type { BinEntry, BinState } from "../../../../shared/bin";
import { flushSync } from "react-dom";
import { worldBinStore } from "../bin/useWorldBin";

/**
 * Waits for `condition` while Town keeps drawing. An actor walks at most
 * 50 ms of its way a frame (townRenderer), so a walk out of its building
 * takes as many frames however long they take to draw: from a far desk,
 * 170 frames, 8 s locally and over 30 s in software rendering on a two-core
 * runner at 1440px. It fails when frames stop coming or a walk takes far
 * more frames than any building needs.
 */
async function whileDrawing(condition: () => boolean, message: string) {
  const drawn = () => window.__HERDR_TOWN_RENDERER__?.frames ?? 0;
  const start = drawn();
  let last = start;
  let since = performance.now();
  while (!condition()) {
    const now = drawn();
    if (now !== last) {
      last = now;
      since = performance.now();
    }
    if (now - start > 600 || performance.now() - since > 5_000)
      throw new Error(`${message} (${now - start} frames drawn)`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Town's bus in a real Town, its trip held still at each moment (a stopped
 * bus's clock stands): it waits parked at Apartments, drives out to the
 * rider's stop and opens its door there, carries the rider in sight in its
 * windows the whole way (side on, or front and back on a side road),
 * comes back to the same spot, and the rider walks in to Apartments, whose
 * sign counts one more. `setBin` sets the fake service's bin, null for its
 * own empty one.
 */
export async function checkTownBusTrip(
  host: HTMLElement,
  check: (condition: boolean, message: string) => void,
  waitFor: (condition: () => boolean, message: string) => Promise<void>,
  setBin: (bin: BinState | null) => void,
  rider: Pick<
    BinEntry,
    | "connection_id"
    | "connection_generation"
    | "workspace_id"
    | "tab_id"
    | "pane_id"
    | "terminal_id"
  >,
) {
  const TRIP = 120_000;
  const entry: BinEntry = {
    ...rider,
    id: "town-bus-trip-proof",
    label: "bus proof",
    view: "town",
    riding: false,
    preserve_tab: false,
  };
  let revision = 1_000;
  const show = async (
    elapsed: number | null,
    riding: boolean,
    over = false,
  ) => {
    revision += 1;
    setBin({
      epoch: "town-bus-trip",
      revision,
      entries: over ? [] : [{ ...entry, riding }],
      closing: over ? [{ ...entry, riding }] : [],
      outcomes: [],
      bus: {
        speed_kmh: 36,
        route_m: riding ? 500 : 0,
        trip_ms: riding ? TRIP : 0,
        elapsed_ms: elapsed,
        stopped: elapsed !== null,
        trip: riding ? 1 : null,
        next_ms: riding ? null : 60_000,
        next_route_m: riding ? 0 : 500,
        next_trip_ms: riding ? 0 : TRIP,
        next_measured: false,
      },
    });
    await worldBinStore().refresh();
    // The bus layer poses the bus and its riders in its effect, which React
    // runs at commit for a store change (a sync update), so the DOM read next
    // is this moment's. Waiting for drawn frames here instead paid a software
    // render of the whole town for every sampled second (#1183).
    flushSync(() => {});
  };
  const bus = () => host.querySelector<HTMLElement>(".town-bus");
  const person = () =>
    host.querySelector<HTMLElement>(".town-bin-rider[data-ride]");
  const sign = () =>
    host.querySelector<HTMLElement>(".town-apartments-sign[data-count]");
  const at = () => {
    const match = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(
      bus()?.style.transform ?? "",
    );
    return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
  };

  try {
    await show(null, false);
    await waitFor(
      () => person() !== null && bus() !== null,
      "a binned agent shows no rider or Town no bus",
    );
    await whileDrawing(
      () => person()!.hasAttribute("data-out"),
      "the binned agent never came out to its stop",
    );
    const parked = at();
    check(
      parked !== null && !bus()!.hidden,
      "the bus is not parked on the map between trips",
    );
    check(
      bus()!.dataset.facing === "right" && !bus()!.hasAttribute("data-moving"),
      "the parked bus is not standing still facing the footpath",
    );
    const before = Number(sign()?.dataset.count ?? Number.NaN);
    check(Number.isFinite(before), "Apartments' sign shows no count");

    // The trip, a second at a time.
    let away = 0;
    let doorsAway = false;
    let aboardMoving = false;
    // Seconds the rider was aboard with no window showing it.
    const unseen: number[] = [];
    const facings = new Set<string>();
    const seen = new Set<string>();
    const sample = async (ms: number) => {
      await show(ms, true);
      const now = at();
      check(
        now !== null && !bus()!.hidden,
        `the bus vanished ${ms / 1000} s into its trip`,
      );
      const moved = Math.hypot(now!.x - parked!.x, now!.y - parked!.y);
      away = Math.max(away, moved);
      if (moved > 40 && bus()!.hasAttribute("data-doors")) doorsAway = true;
      const ride = person()?.dataset.ride ?? "gone";
      seen.add(ride);
      if (ride === "aboard") {
        // In sight in a window of the side it shows, whichever way it faces.
        const shown = [
          ...host.querySelectorAll<HTMLElement>(
            ".town-bus-passenger[data-boarded]",
          ),
        ].some(
          (node) =>
            node.getClientRects().length > 0 &&
            getComputedStyle(node).visibility === "visible",
        );
        if (shown) aboardMoving = true;
        else unseen.push(ms / 1000);
        facings.add(bus()!.dataset.facing ?? "");
      }
      return ride;
    };
    let last = "queue";
    for (let ms = 0; ms < TRIP; ms += 1_000) {
      const ride = await sample(ms);
      // A rider at the kerb boards in well under a second: look closer.
      if (last === "queue" && ride !== "queue" && !seen.has("boarding"))
        for (let fine = Math.max(0, ms - 900); fine < ms; fine += 100)
          await sample(fine);
      last = ride;
    }
    check(away > 40, "the bus never drove out to the rider's stop");
    check(doorsAway, "the bus never opened its door away from Apartments");
    check(aboardMoving, "the rider never showed in the bus's window");
    check(
      !unseen.length,
      `the rider vanished aboard at ${unseen.join(", ")} s (facing ${[...facings].join(", ")})`,
    );
    check(
      facings.has("up") || facings.has("down"),
      "the trip never took a side road, so the end windows went untested",
    );
    for (const ride of ["queue", "boarding", "aboard", "alighting"])
      check(seen.has(ride), `the rider was never seen ${ride}`);

    // The last second: it is back where it started; the rider is in.
    await show(TRIP - 200, true);
    const back = at();
    check(
      back !== null && back.x === parked!.x && back.y === parked!.y,
      `the bus ended its trip at ${JSON.stringify(back)}, not ${JSON.stringify(parked)}`,
    );
    check(person()?.dataset.ride === "home", "the rider is not in at the end");
    await waitFor(
      () => Number(sign()?.dataset.count) === before + 1,
      `Apartments' sign did not count the rider in (${sign()?.dataset.count})`,
    );
    // The service closes it: nobody appears at Apartments or anywhere else.
    await show(null, false, true);
    check(
      person() === null || person()!.dataset.ride !== "queue",
      "the closed rider showed again at its stop",
    );
    check(
      Number(sign()?.dataset.count) === before + 1,
      "Apartments' count changed when the close came through",
    );
  } finally {
    setBin(null);
    await worldBinStore().refresh();
  }
}
