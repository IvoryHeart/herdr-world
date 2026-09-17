import { createPortal } from "react-dom";
import type { ReactNode, Ref } from "react";
import type { InspectorDock } from "../workspaceResource";

export function WorkspaceInspectorPortal({
  target,
  stageRef,
  dock,
  expanded,
  children,
}: {
  target: Element | null;
  stageRef?: Ref<HTMLDivElement>;
  dock: InspectorDock;
  expanded: boolean;
  children: ReactNode;
}) {
  if (!target) return null;
  return createPortal(
    <div
      ref={stageRef}
      className={`workspace-stage world-inspector-stage inspector-dock-${dock} ${
        expanded ? "is-inspector-expanded" : ""
      }`}
    >
      {children}
    </div>,
    target,
  );
}
