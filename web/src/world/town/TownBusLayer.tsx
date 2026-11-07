import { memo, useEffect, useMemo, useRef, type CSSProperties } from "react";
import { binBusClock, type WorldBin } from "../bin/binStore";
import { openWorldBin } from "../bin/worldBinEvents";
import { useWorldBin, worldBinStore } from "../bin/useWorldBin";
import {
  TOWN_STOP_QUEUE,
  townBinRiders,
  townBusAlong,
  townBusAt,
  townBusOpacity,
  townBusRoute,
  townBusTimeline,
  type TownBinRider,
  type TownBusRoute,
} from "./townBus";
import type { TownLayout } from "./townLayout";
import type { TownModel } from "./townModel";
import type { TownRendererHandle } from "./townRenderer";
import { townPortrait } from "./townSprites";
import "./townBus.css";

/** Outdoors, binned agents walk this fast, in world pixels a second. */
const WALK = 90;
/** An entry this page first saw longer ago has already walked to its stop. */
const WALKED_MS = 15_000;
/** A rider steps aboard this long after the bus has stopped for it. */
const BOARD_S = 1.5;

/**
 * The bin as Town shows it: the agents it takes out of their rooms (`away`,
 * for the actors) and those it draws at stops. The set keeps its identity
 * while its members are unchanged, so the actors resync only on a change.
 */
export function useTownBin(model: TownModel, layout: TownLayout) {
  const bin = useWorldBin();
  const route = useMemo(() => townBusRoute(layout), [layout]);
  const placed = useMemo(
    () => townBinRiders(bin.entries, bin.closing, model, layout, route),
    [bin.entries, bin.closing, model, layout, route],
  );
  const members = [...placed.away].sort().join("\n");
  const away: ReadonlySet<string> = useMemo(
    () => new Set(members ? members.split("\n") : []),
    [members],
  );
  return { bin, route, riders: placed.riders, away };
}

/**
 * A waiting agent is shown once its actor has gone out of the front door
 * (the frame just drawn): from then it walks to its stop.
 */
export function markOut(rider: HTMLElement, renderer: TownRendererHandle) {
  const out = renderer.actorPosition(rider.dataset.agent!) === null;
  if (rider.hasAttribute("data-out") !== out)
    rider.toggleAttribute("data-out", out);
}

/**
 * Town's bus stops, the agents waiting at them and the bus. While the
 * service says a bus is out, it drives the route on the trip's clock: it
 * comes in, slows to each stop where someone waits, stands there about
 * 10 s while they board, then speeds up and leaves. Clicking it stops it
 * where it is (nothing closes until it goes on) and opens the bin tray, as
 * a stop does.
 */
export const TownBusLayer = memo(function TownBusLayer({
  bin,
  route,
  riders,
  riderNodes,
  renderer,
  firstSeen,
}: {
  bin: WorldBin;
  route: TownBusRoute;
  riders: readonly TownBinRider[];
  /** Rider elements, marked out on each drawn frame (markOut). */
  riderNodes: Set<HTMLElement>;
  renderer: { readonly current: TownRendererHandle | null };
  firstSeen(id: string): number;
}) {
  const bus = useRef<HTMLButtonElement>(null);
  const riderRefs = useRef(new Map<string, HTMLElement>());
  const waiting = new Map<string, number>();
  for (const rider of riders)
    waiting.set(rider.stop.key, (waiting.get(rider.stop.key) ?? 0) + 1);
  const riding = riders.filter((rider) => rider.entry.riding).length;
  // The stops this trip halts at, kept for the whole trip so the bus never
  // jumps when a rider is put back; a stop is only ever added.
  const halting = useRef<{ trip: number | null; keys: Set<string> }>({
    trip: null,
    keys: new Set(),
  });
  if (halting.current.trip !== bin.bus.trip)
    halting.current = { trip: bin.bus.trip, keys: new Set() };
  for (const rider of riders)
    if (rider.entry.riding) halting.current.keys.add(rider.stop.key);
  const haltKey = [...halting.current.keys].sort().join("\n");
  const timeline = useMemo(
    () => townBusTimeline(route, new Set(haltKey.split("\n")), bin.bus.trip_ms),
    [route, haltKey, bin.bus.trip_ms],
  );

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const { elapsed } = binBusClock(bin, performance.now());
      const along = elapsed === null ? null : townBusAlong(timeline, elapsed);
      const element = bus.current;
      if (element) {
        element.hidden = along === null;
        if (along !== null) {
          const at = townBusAt(route, along);
          element.style.transform = `translate(${at.x}px, ${at.y}px)`;
          element.style.opacity = String(townBusOpacity(route, at.x));
          element.dataset.facing = at.facing;
        }
      }
      for (const rider of riders) {
        const node = riderRefs.current.get(rider.entry.id);
        const halt = timeline.halts.get(rider.stop.key);
        const boarded =
          rider.entry.riding &&
          elapsed !== null &&
          along !== null &&
          (halt === undefined
            ? along >= rider.stop.at
            : elapsed / 1000 >= halt + BOARD_S);
        if (node && node.hasAttribute("data-boarded") !== boarded)
          node.toggleAttribute("data-boarded", boarded);
      }
      if (elapsed !== null && !bin.bus.stopped)
        frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [bin, route, riders, timeline]);

  const now = performance.now();
  return (
    <div className="town-bus-layer" data-testid="town-bus">
      {route.stops.map((stop) => {
        const count = waiting.get(stop.key) ?? 0;
        return (
          <button
            key={stop.key}
            type="button"
            className="town-bus-stop"
            data-stop={stop.key}
            data-waiting={count || undefined}
            style={{ left: stop.wait.x + 6, top: stop.wait.y }}
            // An empty stop is scenery; the bin is also reachable from its chip.
            tabIndex={count ? 0 : -1}
            aria-hidden={count ? undefined : true}
            aria-label={count ? `Bus stop, ${count} waiting` : undefined}
            // Dropping an agent here puts it in the bin, as on the bin.
            data-bin-drop=""
            onClick={openWorldBin}
          >
            <span className="town-bus-roundel" aria-hidden="true" />
            {count > TOWN_STOP_QUEUE ? (
              <em>+{count - TOWN_STOP_QUEUE}</em>
            ) : null}
          </button>
        );
      })}
      {riders.map((rider) => {
        const dx = rider.door.x - rider.at.x;
        const dy = rider.door.y - rider.at.y;
        const walk = now - firstSeen(rider.entry.id) < WALKED_MS;
        return (
          <div
            key={rider.entry.id}
            ref={(node) => {
              if (node) {
                riderRefs.current.set(rider.entry.id, node);
                riderNodes.add(node);
                if (renderer.current) markOut(node, renderer.current);
              } else {
                const old = riderRefs.current.get(rider.entry.id);
                if (old) riderNodes.delete(old);
                riderRefs.current.delete(rider.entry.id);
              }
            }}
            className="town-bin-rider"
            data-agent={rider.agentKey}
            data-bin-entry={rider.entry.id}
            data-walk={walk || undefined}
            data-queued={rider.slot >= TOWN_STOP_QUEUE || undefined}
            title={`${rider.entry.label}, waiting for the bus`}
            style={
              {
                left: rider.at.x,
                top: rider.at.y,
                "--dx": `${dx}px`,
                "--dy": `${dy}px`,
                "--tx": `${Math.abs(dx) / WALK}s`,
                "--ty": `${Math.abs(dy) / WALK}s`,
              } as CSSProperties
            }
          >
            <img src={townPortrait(rider.agentKey)} alt="" />
          </div>
        );
      })}
      <button
        ref={bus}
        type="button"
        className="town-bus"
        hidden
        data-stopped={bin.bus.stopped || undefined}
        aria-label={
          bin.bus.stopped
            ? `The bus, stopped, ${riding} aboard`
            : `The bus, ${riding} aboard; stop it`
        }
        onClick={() => {
          // Stopped, nothing closes until it is let go from the tray.
          if (!bin.bus.stopped) void worldBinStore().stopBus();
          openWorldBin();
        }}
      >
        <span className="town-bus-deck" aria-hidden="true" />
        <span className="town-bus-deck town-bus-lower" aria-hidden="true" />
      </button>
    </div>
  );
});
