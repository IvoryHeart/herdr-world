import { Fragment, useRef } from "react";
import { Plus } from "lucide-react";
import type { OfficeRect } from "./officeGeometry";
import type { PublishedOfficeLayout } from "./officeLayout";
import { officeIntersects } from "./officeVirtualization";
import type { OfficeCreationActionState } from "./officeRoomActions";

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
  creationState,
  onCreateRoom,
}: {
  layout: PublishedOfficeLayout;
  renderedRevision: number;
  viewport?: OfficeRect;
  onToggle(key: string): void;
  creationState(hostKey: string): OfficeCreationActionState;
  onCreateRoom(hostKey: string): void;
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
        .map((building) => {
          const creation = creationState(building.key);
          return (
            <Fragment key={building.key}>
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
                  width:
                    building.headerRect.width - (creation.visible ? 64 : 0),
                  height: building.headerRect.height,
                }}
              >
                <span
                  className="world-office-building-toggle"
                  aria-hidden="true"
                >
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
              {creation.visible ? (
                <button
                  type="button"
                  className="world-new-room-canvas-action"
                  data-host-key={building.key}
                  aria-label={`New room in ${building.title}`}
                  title={
                    creation.reason ?? `Create a workspace on ${building.title}`
                  }
                  disabled={
                    (!ready && building.key !== focusedKey) || !creation.enabled
                  }
                  aria-disabled={!ready || !creation.enabled}
                  style={{
                    left:
                      building.headerRect.x + building.headerRect.width - 62,
                    top:
                      building.headerRect.y +
                      (building.headerRect.height - 48) / 2,
                  }}
                  onClick={() => {
                    if (ready && creation.enabled) onCreateRoom(building.key);
                  }}
                >
                  <Plus size={22} aria-hidden="true" />
                  <span>NEW ROOM</span>
                </button>
              ) : null}
              {creation.reason ? (
                <span
                  className="world-creation-reason"
                  role="status"
                  style={{
                    left:
                      building.headerRect.x + building.headerRect.width - 180,
                    top: building.headerRect.y + building.headerRect.height + 4,
                  }}
                >
                  {creation.reason}
                </span>
              ) : null}
            </Fragment>
          );
        })}
    </div>
  );
}
