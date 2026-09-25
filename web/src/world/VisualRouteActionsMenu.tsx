import { ListFilter } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  shortcutMatches,
  shortcutTitle,
  useShortcutPreferences,
} from "../shortcutPreferences";
import type { InspectorView } from "../workspaceResource";
import type { WorldObject, WorldObjectNode } from "./worldObject";
import {
  resolveVisualRouteActionTarget,
  visualRouteActionsForNode,
  visualRouteActionTarget,
  visualRouteTargetLabel,
  type VisualRouteAction,
  type VisualRouteActionTarget,
} from "./visualRouteActions";

const actionLabels: Record<VisualRouteAction, string> = {
  terminal: "Terminal",
  files: "Files",
  changes: "Changes",
  history: "Agent History",
  spaces: "Go to Spaces",
};

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

export function VisualRouteActions({
  selection,
  world,
  activeConnectionId,
  runtimeGeneration,
  onResource,
  onGoToSpaces,
  onError,
}: {
  selection: WorldObjectNode | null;
  world: WorldObject;
  activeConnectionId: string;
  runtimeGeneration: number | null;
  onResource(node: WorldObjectNode, view: InspectorView): Promise<boolean>;
  onGoToSpaces(node: WorldObjectNode): Promise<boolean>;
  onError(reason: string): void;
}) {
  useShortcutPreferences();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<VisualRouteActionTarget | null>(null);
  const [invalidReason, setInvalidReason] = useState<string | null>(null);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    setTarget(null);
    setInvalidReason(null);
    if (restoreFocus) requestAnimationFrame(() => buttonRef.current?.focus());
  }, []);
  const openActions = useCallback(() => {
    setTarget(visualRouteActionTarget(selection));
    setInvalidReason(null);
    setOpen(true);
  }, [selection]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (open && event.key === "Escape") {
        event.preventDefault();
        close(true);
        return;
      }
      if (
        !shortcutMatches(event, "command.menu") ||
        (isTypingTarget(event.target) &&
          !(
            event.target instanceof Element &&
            event.target.closest(".world-visual-actions")
          ))
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (open) close(true);
      else openActions();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [close, open, openActions]);

  useEffect(() => {
    if (!open || !target) return;
    const result = resolveVisualRouteActionTarget(target, world, {
      activeConnectionId,
      runtimeGeneration,
      selectedId: selection?.id ?? null,
    });
    if (result.node) return;
    setTarget(null);
    setInvalidReason(result.reason);
  }, [
    activeConnectionId,
    open,
    runtimeGeneration,
    selection?.id,
    target,
    world,
  ]);

  useEffect(() => {
    if (!open) return;
    const firstAction = menuRef.current?.querySelector<HTMLButtonElement>(
      "[data-world-visual-action]",
    );
    requestAnimationFrame(() => firstAction?.focus());
  }, [open]);

  const resolved = resolveVisualRouteActionTarget(target, world, {
    activeConnectionId,
    runtimeGeneration,
    selectedId: selection?.id ?? null,
  });
  const available = resolved.node
    ? visualRouteActionsForNode(resolved.node)
    : [];
  const message = invalidReason ?? resolved.reason;
  const run = async (action: VisualRouteAction) => {
    if (!resolved.node) {
      onError(resolved.reason ?? "The selected item is no longer available.");
      setTarget(null);
      setInvalidReason(resolved.reason);
      return;
    }
    if (!available.includes(action)) {
      const reason = `${actionLabels[action]} is not available for this selection.`;
      onError(reason);
      setTarget(null);
      setInvalidReason(reason);
      return;
    }
    const admitted =
      action === "spaces"
        ? await onGoToSpaces(resolved.node)
        : await onResource(resolved.node, action);
    if (admitted) close();
  };

  return (
    <div className="world-visual-actions" ref={menuRef}>
      <button
        ref={buttonRef}
        type="button"
        className="world-visual-actions-trigger"
        aria-label="Actions"
        aria-expanded={open}
        aria-haspopup="menu"
        title={shortcutTitle("Actions", "command.menu")}
        onClick={() => (open ? close() : openActions())}
      >
        <ListFilter size={15} aria-hidden="true" />
        <span>Actions</span>
      </button>
      {open ? (
        <div
          className="world-visual-actions-menu"
          role="menu"
          aria-label="Actions"
        >
          {resolved.node ? (
            <>
              <p className="world-visual-actions-target" role="status">
                Actions for {visualRouteTargetLabel(resolved.node)}
              </p>
              {available.map((action) => (
                <button
                  key={action}
                  type="button"
                  role="menuitem"
                  data-world-visual-action
                  onClick={() => void run(action)}
                >
                  {actionLabels[action]}
                </button>
              ))}
              {available.length === 0 ? (
                <p className="world-visual-actions-reason" role="status">
                  No actions are available for this selection.
                </p>
              ) : null}
            </>
          ) : (
            <p className="world-visual-actions-reason" role="status">
              {message ?? "Select a space, agent, or terminal first."}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
