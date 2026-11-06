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
          <svg viewBox="0 0 24 38" aria-hidden="true">
            <path d="M11 19h2v17h-2z" fill="#ddd4bb" />
            <path d="M7 36h10v2H7z" fill="#40505e" />
            <path d="M2 0h20v24H2z" fill="#fff6df" stroke="#28343d" />
            <circle
              cx="12"
              cy="9"
              r="6"
              fill="none"
              stroke="#c92e34"
              strokeWidth="3"
            />
            <path d="M3 7h18v4H3z" fill="#253b67" />
            <text
              x="12"
              y="21"
              textAnchor="middle"
              fontSize="4"
              fontFamily="monospace"
              fontWeight="bold"
              fill="#26313f"
            >
              BUS STOP
            </text>
          </svg>
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
          <svg viewBox="0 0 64 42" aria-hidden="true">
            <ellipse
              cx="32"
              cy="39"
              rx="30"
              ry="3"
              fill="#172330"
              opacity=".5"
            />
            <path
              d="M3 5h51l7 7v24H2V8z"
              fill="#c92e34"
              stroke="#552832"
              strokeWidth="2"
            />
            <path
              d="M6 8h8v9H6zm11 0h8v9h-8zm11 0h8v9h-8zm11 0h8v9h-8zm11 0h3l5 5v4h-8zM6 24h8v8H6zm11 0h8v8h-8zm11 0h8v8h-8zm11 0h8v8h-8z"
              fill="#9dc4cd"
            />
            <path d="M7 9h6m5 0h6m5 0h6m5 0h6" stroke="#e8e1c6" />
            <path d="M4 19h45v3H4z" fill="#eee0b8" />
            <path d="M50 23h8v12h-8z" fill="#253844" stroke="#eee0b8" />
            <path d="M54 23v12" stroke="#eee0b8" />
            <path d="M3 34h45v2H3z" fill="#8c232d" />
            <path d="M58 31h3v3h-3z" fill="#ffe4a0" />
            <circle cx="13" cy="36" r="5" fill="#202a35" />
            <circle cx="46" cy="36" r="5" fill="#202a35" />
            <circle cx="13" cy="36" r="2" fill="#c5c2b2" />
            <circle cx="46" cy="36" r="2" fill="#c5c2b2" />
            <text
              x="53"
              y="21"
              textAnchor="middle"
              fontSize="4"
              fontFamily="monospace"
              fill="#fff6df"
            >
              3
            </text>
          </svg>
        </button>
      ) : null}
    </>
  );
}
