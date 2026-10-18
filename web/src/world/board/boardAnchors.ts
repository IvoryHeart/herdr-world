import type { BoardAnchor } from "./boardDocument";
import {
  boardKey,
  type BoardModel,
  type BoardPane,
  type BoardTab,
} from "./boardModel";

/**
 * Between Board's cards and the anchors saved with strings. An anchor names a
 * Herdr workspace, tab or pane by connection profile and native ID, and keeps
 * the terminal IDs last seen in its target as a continuity witness.
 */

export type AnchorTarget = {
  /** The card to draw the string to. */
  cardKey: string;
  /** For a pane anchor, the pane's key. */
  paneKey?: string;
  /** Terminal IDs present in the target now. */
  terminals: string[];
};

const terminalsOf = (panes: readonly BoardPane[]) =>
  panes.map((pane) => pane.leaf.terminalId).filter(Boolean);

/** The anchor for a card (and optionally one of its panes). */
export function anchorFor(
  model: BoardModel,
  cardKey: string,
  paneKey?: string,
): BoardAnchor | null {
  const space = model.workspaceByKey.get(cardKey);
  if (space)
    return {
      connection_id: space.connectionId,
      kind: "workspace",
      native_id: space.nativeId,
      witness: terminalsOf(
        space.tabKeys.flatMap((key) => model.tabByKey.get(key)?.panes ?? []),
      ).slice(0, 16),
    };
  const tab = model.tabByKey.get(cardKey);
  if (!tab) return null;
  const pane = paneKey
    ? tab.panes.find((candidate) => candidate.key === paneKey)
    : undefined;
  if (pane)
    return {
      connection_id: pane.leaf.connectionId,
      kind: "pane",
      native_id: pane.leaf.nativeId,
      witness: [pane.leaf.terminalId].filter(Boolean),
    };
  return {
    connection_id: model.workspaceByKey.get(tab.workspaceKey)!.connectionId,
    kind: "tab",
    native_id: tab.nativeId,
    witness: terminalsOf(tab.panes).slice(0, 16),
  };
}

/** Where an anchor's target is on the board now, if it is admitted. */
export function targetOf(
  model: BoardModel,
  anchor: BoardAnchor,
): AnchorTarget | null {
  const key = boardKey(anchor.connection_id, anchor.native_id);
  if (anchor.kind === "workspace") {
    const space = model.workspaceByKey.get(key);
    if (!space) return null;
    return {
      cardKey: key,
      terminals: terminalsOf(
        space.tabKeys.flatMap(
          (tabKey) => model.tabByKey.get(tabKey)?.panes ?? [],
        ),
      ),
    };
  }
  if (anchor.kind === "tab") {
    const tab = model.tabByKey.get(key);
    return tab ? { cardKey: key, terminals: terminalsOf(tab.panes) } : null;
  }
  let owner: BoardTab | undefined;
  let pane: BoardPane | undefined;
  for (const tab of model.tabs) {
    pane = tab.panes.find((candidate) => candidate.key === key);
    if (pane) {
      owner = tab;
      break;
    }
  }
  return owner && pane
    ? { cardKey: owner.key, paneKey: pane.key, terminals: terminalsOf([pane]) }
    : null;
}

/**
 * An anchor is confirmed when its target is on the board and still holds a
 * terminal it was last seen with (or held none and still exists). Terminal IDs change only when Herdr
 * restarts, so this holds across World restarts and reconnects.
 */
export function confirmed(anchor: BoardAnchor, target: AnchorTarget | null) {
  if (!target) return false;
  // A workspace (or tab) that held no terminals when it was strung or kept
  // has nothing to witness; it is confirmed while it exists. Such anchors
  // never authorise Send. A pane always needs a matching witnessed terminal.
  if (!anchor.witness.length) return anchor.kind !== "pane";
  return anchor.witness.some((terminal) => target.terminals.includes(terminal));
}

/**
 * The witness to record for a confirmed anchor whose target's terminals have
 * changed (a pane opened or closed, or an empty workspace got a tab), so its
 * continuity carries on; null when nothing changed or it is not confirmed.
 */
export function nextWitness(
  anchor: BoardAnchor,
  target: AnchorTarget | null,
  limit = 16,
): string[] | null {
  if (!target || !confirmed(anchor, target)) return null;
  const now = target.terminals.slice(0, limit);
  const same =
    now.length === anchor.witness.length &&
    now.every((terminal) => anchor.witness.includes(terminal));
  return same ? null : now;
}

/** What a desk move reports: the new tab and each pane's old and new ID. */
