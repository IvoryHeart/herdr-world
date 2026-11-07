import { PanelsTopLeft } from "lucide-react";
import { createPortal } from "react-dom";
import type { WindowSwitcherEntry } from "./WindowSwitcher";
import "./windows.css";

/**
 * On a phone a minimized window waits at the bottom of the view it came from:
 * one tap on its chip restores it. A window fills the phone screen, so the dock
 * shows only while no window is open over the view; an open window reaches the
 * others through ⋯.
 */
export function MinimizedWindowDock({
  entries = [],
}: {
  entries?: readonly WindowSwitcherEntry[];
}) {
  const minimized = entries.filter((entry) => entry.minimized);
  if (!minimized.length || minimized.length < entries.length) return null;
  return createPortal(
    <nav className="world-minimized-dock" aria-label="Minimized windows">
      {minimized.map((entry) => (
        <button
          key={entry.id}
          type="button"
          data-restore-window-id={entry.id}
          aria-label={`Restore ${entry.label}`}
          title={`Restore ${entry.label}`}
          onClick={entry.onSelect}
        >
          <PanelsTopLeft size={15} aria-hidden="true" />
          <span>{entry.label}</span>
        </button>
      ))}
    </nav>,
    document.body,
  );
}
