import { useRef } from "react";
import type { OfficeRect } from "./officeGeometry";
import type { PublishedOfficeLayout } from "./officeLayout";
import { officeIntersects } from "./officeVirtualization";

const HOST_STATES: Record<string, string> = {
  active: "Active",
  "ready-inactive": "Ready",
  reconnecting: "Reconnecting",
  "offline-stale": "Offline",
};
const hostState = (state: string, stale: boolean) =>
  `${HOST_STATES[state] ?? state}${stale ? " · stale" : ""}`;

export function OfficeBuildingsOverlay({
  layout,
  renderedRevision,
  viewport,
  onToggle,
}: {
  layout: PublishedOfficeLayout;
  renderedRevision: number;
  viewport?: OfficeRect;
  onToggle(key: string): void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const active = document.activeElement as HTMLElement | null;
  const focusedKey =
    active && root.current?.contains(active) ? active.dataset.hostKey : null;
  const ready =
    layout.layoutRevision > 0 && layout.layoutRevision === renderedRevision;
  return (
    <div
      ref={root}
      className="world-office-buildings-overlay"
      aria-label="Office host buildings"
    >
      {layout.buildings
        ?.filter(
          (building) =>
            building.key === focusedKey ||
            officeIntersects(building.headerRect, viewport),
        )
        .map((building) => (
          <button
            key={building.key}
            type="button"
            className="world-office-building-header"
            data-host-key={building.key}
            aria-expanded={!building.collapsed}
            aria-label={`${building.collapsed ? "Expand" : "Collapse"} host ${building.title}`}
            disabled={!ready && building.key !== focusedKey}
            aria-disabled={!ready}
            onClick={() => {
              if (ready) onToggle(building.key);
            }}
            title={`${building.title} · ${hostState(building.state, building.stale)} · ${building.roomIndices.length} rooms · ${building.agentCount} agents · ${building.attentionCount} need attention`}
            style={{
              left: building.headerRect.x,
              top: building.headerRect.y,
              width: building.headerRect.width,
              height: building.headerRect.height,
            }}
          >
            <span className="world-office-building-toggle" aria-hidden="true">
              {building.collapsed ? "+" : "−"}
            </span>
            <span className="world-office-building-description">
              <strong>{building.title}</strong>
              <span>
                {building.roomIndices.length} rooms · {building.agentCount}{" "}
                agents
              </span>
            </span>
            <span className="world-office-building-signals">
              <span>{hostState(building.state, building.stale)}</span>
              {building.attentionCount > 0 ? (
                <span className="world-office-building-attention">
                  {building.attentionCount} need attention
                </span>
              ) : null}
            </span>
          </button>
        ))}
    </div>
  );
}
