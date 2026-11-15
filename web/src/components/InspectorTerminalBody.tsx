import type { ReactNode } from "react";

/**
 * The Inspector's Terminal tab body. A runtime World does not show through
 * Herdr (a herdr-core terminal's watch) passes its own `terminal`: it stays
 * mounted while the tab is away, so its stream and the size World holds for
 * it survive a look at Chat. A Herdr terminal is portalled in while shown.
 */
export function InspectorTerminalBody({
  shown,
  terminal,
  terminalDetached,
  onFocusTabWindow,
  onTerminalPortalChange,
}: {
  shown: boolean;
  terminal?: ReactNode;
  terminalDetached: boolean;
  onFocusTabWindow?: () => void;
  onTerminalPortalChange?: (element: HTMLDivElement | null) => void;
}) {
  if (terminal !== undefined) return terminal;
  if (!shown) return null;
  if (onFocusTabWindow)
    return (
      <div className="workspace-inspector-terminal-detached" role="status">
        <span>The terminal is in its tab window.</span>
        <button
          type="button"
          className="workspace-inspector-focus-tab-action"
          onClick={onFocusTabWindow}
        >
          Focus tab window
        </button>
      </div>
    );
  if (terminalDetached)
    return (
      <div className="workspace-inspector-terminal-detached" role="status">
        Terminal is floating.
      </div>
    );
  return (
    <div
      ref={onTerminalPortalChange}
      className="workspace-inspector-terminal-portal"
    />
  );
}
