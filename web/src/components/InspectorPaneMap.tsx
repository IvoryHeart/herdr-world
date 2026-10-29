import { useState, type CSSProperties } from "react";
import { Check } from "lucide-react";
import type { Pane, PaneLayout, Workspace } from "../types";
import { useVisibleTabLayoutState } from "../visibleTabLayout";
import { agentName, inspectorAgentContext } from "./agentDisplayName";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import "./InspectorPaneMap.css";

type MapPane = {
  paneId: string;
  name: string;
  stateLabel: string;
  tone: string;
  style: CSSProperties;
};

/**
 * The tab's split, first in a multi-pane window's title. One tap opens a map
 * of Herdr's real layout; tapping a pane shows that agent in this window.
 * Selecting changes only what World shows, never Herdr's own focus.
 */
export function InspectorPaneMap({
  tabPanes,
  ...props
}: {
  workspaceId: string;
  tabId: string;
  tabLabel?: string;
  tabPanes: readonly Pane[];
  workspace?: Workspace;
  selectedPaneId?: string;
  onSelect(paneId: string): void;
}) {
  // A single-pane tab shows no glyph and reads no layout.
  return tabPanes.length > 1 ? (
    <PaneMapButton tabPanes={tabPanes} {...props} />
  ) : null;
}

function PaneMapButton({
  workspaceId,
  tabId,
  tabLabel,
  tabPanes,
  workspace,
  selectedPaneId,
  onSelect,
}: Parameters<typeof InspectorPaneMap>[0]) {
  const { layout } = useVisibleTabLayoutState(workspaceId, tabId);
  const [open, setOpen] = useState(false);
  const cells = layout ? mapPanes(layout, tabPanes, workspace) : [];
  if (cells.length < 2) return null;
  const selected = cells.find((cell) => cell.paneId === selectedPaneId);
  const title = `${tabLabel ? `${tabLabel} · ` : ""}${cells.length} panes`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inspector-pane-map-glyph"
          aria-label={`Panes in this tab: ${cells.length}${
            selected ? `, showing ${selected.name}` : ""
          }`}
          title="Switch to another pane in this tab"
        >
          {cells.map((cell) => (
            <i
              key={cell.paneId}
              style={cell.style}
              data-tone={cell.tone}
              className={cell.paneId === selectedPaneId ? "is-selected" : ""}
            />
          ))}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="inspector-pane-map"
        align="start"
        aria-label="Panes in this tab"
      >
        <strong className="inspector-pane-map-title">{title}</strong>
        <div className="inspector-pane-map-area">
          {cells.map((cell) => (
            <button
              key={cell.paneId}
              type="button"
              className="inspector-pane-map-cell"
              style={cell.style}
              data-tone={cell.tone}
              data-map-pane-id={cell.paneId}
              aria-pressed={cell.paneId === selectedPaneId}
              aria-label={`${cell.name}, ${cell.stateLabel}`}
              onClick={() => {
                setOpen(false);
                if (cell.paneId !== selectedPaneId) onSelect(cell.paneId);
              }}
            >
              <span className="inspector-pane-map-mark" aria-hidden="true">
                {cell.tone === "done" ? (
                  <Check size={9} strokeWidth={3.5} />
                ) : cell.tone === "blocked" ? (
                  "!"
                ) : null}
              </span>
              <b>{cell.name}</b>
              <small>{cell.stateLabel}</small>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Herdr's pane rects as percentages of the tab, with each pane's agent. */
function mapPanes(
  layout: PaneLayout,
  tabPanes: readonly Pane[],
  workspace: Workspace | undefined,
): MapPane[] {
  const { area } = layout;
  const width = Math.max(1, area.width);
  const height = Math.max(1, area.height);
  return layout.panes.flatMap((layoutPane) => {
    const pane = tabPanes.find((item) => item.pane_id === layoutPane.pane_id);
    if (!pane) return [];
    const agent = inspectorAgentContext(pane, workspace);
    const cwd = pane.foreground_cwd ?? pane.cwd;
    const { rect } = layoutPane;
    return [
      {
        paneId: pane.pane_id,
        name: agent
          ? agentName(agent)
          : cwd?.split(/[\\/]/).filter(Boolean).pop() || "Terminal",
        stateLabel: agent?.stateLabel ?? "terminal",
        tone: agent?.statusTone ?? "unknown",
        style: {
          left: `${((rect.x - area.x) / width) * 100}%`,
          top: `${((rect.y - area.y) / height) * 100}%`,
          width: `${(rect.width / width) * 100}%`,
          height: `${(rect.height / height) * 100}%`,
        },
      },
    ];
  });
}
