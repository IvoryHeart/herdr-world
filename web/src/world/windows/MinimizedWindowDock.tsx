import { PanelsTopLeft } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { WindowSwitcherEntry } from "./WindowSwitcher";
import "./windows.css";

/**
 * On a phone a minimized window waits as a chip: one tap restores it. With
 * no window open the chips sit at the bottom of the view the windows came
 * from. A window fills the phone screen, so while one is open the chips form
 * a strip at the bottom of that window, below its content rather than over
 * it.
 */
export function MinimizedWindowDock({
  entries = [],
}: {
  entries?: readonly WindowSwitcherEntry[];
}) {
  const minimized = entries.filter((entry) => entry.minimized);
  const open = entries.filter((entry) => !entry.minimized);
  const shownId = (open.find((entry) => entry.active) ?? open[0])?.id;
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setFrame(
      shownId === undefined
        ? null
        : document.querySelector<HTMLElement>(
            `.world-managed-window.is-compact[data-window-id="${CSS.escape(shownId)}"]`,
          ),
    );
  }, [shownId, minimized.length]);
  const host =
    shownId !== undefined &&
    frame?.isConnected &&
    frame.dataset.windowId === shownId
      ? frame
      : null;
  if (!minimized.length || (shownId !== undefined && !host)) return null;
  return createPortal(
    <nav
      className={`world-minimized-dock${host ? " is-in-window" : ""}`}
      aria-label="Minimized windows"
    >
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
    host ?? document.body,
  );
}
