import { memo, useEffect, useMemo, useRef, type CSSProperties } from "react";
import { binBusClock, type WorldBin } from "../bin/binStore";
import { openWorldBin } from "../bin/worldBinEvents";
import { useWorldBin } from "../bin/useWorldBin";
import {
  TOWN_STOP_QUEUE,
  townBinRiders,
  townBusAt,
  townBusRoute,
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
 * Town's bus stops, the agents waiting at them and the bus. The bus drives
 * the route while the service says one is out, and each rider boards (is no
 * longer drawn) as it passes their stop. Stops and the bus open the bin tray.
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

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const { elapsed } = binBusClock(bin, performance.now());
      const element = bus.current;
      const along =
        elapsed === null ? -1 : (route.length * elapsed) / bin.bus.trip_ms;
      if (element) {
        element.hidden = elapsed === null;
        if (elapsed !== null) {
          const at = townBusAt(route, along);
          element.style.transform = `translate(${at.x}px, ${at.y}px)`;
          element.dataset.facing = at.facing;
        }
      }
      for (const rider of riders) {
        const node = riderRefs.current.get(rider.entry.id);
        const boarded = rider.entry.riding && along >= rider.stop.at;
        if (node && node.hasAttribute("data-boarded") !== boarded)
          node.toggleAttribute("data-boarded", boarded);
      }
      if (elapsed !== null) frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [bin, route, riders]);

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
            onClick={openWorldBin}
          >
            <span aria-hidden="true">B</span>
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
        aria-label={`The bus, ${riding} aboard`}
        onClick={openWorldBin}
      >
        <span className="town-bus-windows" aria-hidden="true" />
      </button>
    </div>
  );
});
