import { X } from "lucide-react";
import {
  WindowBackButton,
  WindowControls,
  type ManagedWindowControls,
} from "../world/windows/WindowControls";
import "./InspectorLoadingShell.css";

/**
 * The Inspector's frame and bar while its code downloads: its name, Back and
 * the window controls (or Close) stay usable, so a cold first open never
 * shows an empty window.
 */
export function InspectorLoadingShell({
  title,
  windowControls,
  onClose,
}: {
  title: string;
  windowControls?: ManagedWindowControls;
  onClose: () => void;
}) {
  return (
    <aside
      className="inspector-loading-shell"
      aria-label="Workspace Inspector"
      aria-busy="true"
    >
      <header className="inspector-loading-shell-head">
        {windowControls ? (
          <WindowBackButton
            controls={windowControls}
            label="Inspector window"
          />
        ) : null}
        <span className="inspector-loading-shell-title">{title}</span>
        {windowControls ? (
          <WindowControls controls={windowControls} label="Inspector window" />
        ) : (
          <div className="workspace-inspector-actions">
            <button
              type="button"
              title="Close Inspector"
              aria-label="Close Workspace Inspector"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </header>
      <div className="terminal-loading" role="status">
        <span className="terminal-loading-dot" />
        Loading Inspector
      </div>
    </aside>
  );
}
