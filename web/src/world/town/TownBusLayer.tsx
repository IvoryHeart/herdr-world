import { BusFront } from "lucide-react";
import { BIN_BUS_DRIVE_MS } from "../../../../shared/bin";
import { openBin } from "../bin/binStore";
import { TOWN_TILE as T } from "./townLayout";
import type { TownTransit } from "./townBus";
import "./townBus.css";

export function TownBusLayer({ transit }: { transit: TownTransit }) {
  const { route, bus } = transit;
  const path = route.points
    .map((point, i) => `${i ? "L" : "M"}${point.x * T},${point.y * T}`)
    .join(" ");
  const elapsed =
    (bus?.elapsed_ms ?? 0) + Math.max(0, performance.now() - transit.readAt);
  return (
    <>
      {route.stops.map((stop) => (
        <button
          type="button"
          className="town-bus-stop"
          key={stop.key}
          style={{ left: stop.x * T, top: stop.y * T }}
          aria-label="Bus stop — open agent bin"
          title="Bus every 3 minutes · open bin"
          onClick={openBin}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span>B</span>
        </button>
      ))}
      {bus?.driving && route.points.length ? (
        <button
          key={bus.cycle}
          type="button"
          className="town-scheduled-bus"
          aria-label="Town bus — open agent bin"
          title="Town bus · open bin"
          onClick={openBin}
          onPointerDown={(event) => event.stopPropagation()}
          style={{
            offsetPath: `path("${path}")`,
            animationDuration: `${BIN_BUS_DRIVE_MS}ms`,
            animationDelay: `-${elapsed}ms`,
          }}
        >
          <BusFront size={30} />
        </button>
      ) : null}
    </>
  );
}
