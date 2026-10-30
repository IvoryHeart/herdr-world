import type { BinTarget, BinView } from "../../../../shared/bin";
import { tabCloseBlockReason, tabPinsFor } from "../../tabPins";
import type { WorldLeafObject } from "../worldObject";
import type { BinDrag } from "./WorldBin";

export const UNREACHABLE_BIN_REASON =
  "This host can't be reached, so its agents can't be closed";

/** An agent a view could drop in the bin, and why it can't, if it can't. */
export type BinCandidate = {
  target: BinTarget & { label: string; view: BinView };
  drag: BinDrag;
};

/** What the bin needs to know about an agent, from any view's model. */
export type BinSubject = {
  connectionId: string;
  generation: number;
  workspaceId: string;
  tabId: string;
  paneId: string;
  terminalId: string;
  label: string;
  /** Its host's topology is cached after a failure, or it can't be acted on. */
  unreachable: boolean;
  working: boolean;
  /** Panes in its tab, this one included. */
  tabPanes: number;
};

export function leafBinSubject(
  leaf: WorldLeafObject,
  tabPanes: number,
): BinSubject {
  return {
    connectionId: leaf.connectionId,
    generation: leaf.generation,
    workspaceId: leaf.workspaceId,
    tabId: leaf.tabId,
    paneId: leaf.nativeId,
    terminalId: leaf.terminalId,
    label: leaf.agentName || leaf.agentLabel || leaf.label || "Agent",
    unreachable: leaf.stale || !leaf.actionable,
    working: leaf.status === "working",
    tabPanes,
  };
}

/**
 * The bin closes one pane. A pinned tab is refused with the tab bar's reason
 * (pins live in this browser, so the check happens here), and so is a host
 * whose topology is cached after a failure.
 */
export function binCandidate(subject: BinSubject, view: BinView): BinCandidate {
  const pinned = tabCloseBlockReason(
    subject.tabId,
    tabPinsFor(subject.connectionId),
  );
  const refusal = subject.unreachable
    ? UNREACHABLE_BIN_REASON
    : pinned
      ? pinned.replace(/\.$/u, "")
      : null;
  return {
    target: {
      connection_id: subject.connectionId,
      connection_generation: subject.generation,
      workspace_id: subject.workspaceId,
      tab_id: subject.tabId,
      pane_id: subject.paneId,
      terminal_id: subject.terminalId,
      label: subject.label,
      view,
    },
    drag: {
      label: subject.label,
      refusal,
      working: subject.working,
      keeps: Math.max(0, subject.tabPanes - 1),
    },
  };
}

/** Whether a screen point is over the bin (with a forgiving margin). */
export function overBin(x: number, y: number) {
  const can = document.querySelector<HTMLElement>(".world-bin-can");
  if (!can) return false;
  const rect = can.getBoundingClientRect();
  if (!rect.width) return false;
  return (
    x > rect.left - 24 &&
    x < rect.right + 24 &&
    y > rect.top - 24 &&
    y < rect.bottom + 12
  );
}
