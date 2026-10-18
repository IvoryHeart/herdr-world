import type { BoardAnchor, BoardEnd } from "./boardDocument";
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
 * terminal it was last seen with. Terminal IDs change only when Herdr
 * restarts, so this holds across World restarts and reconnects.
 */
export function confirmed(anchor: BoardAnchor, target: AnchorTarget | null) {
  return Boolean(
    target &&
      anchor.witness.some((terminal) => target.terminals.includes(terminal)),
  );
}

/** What a desk move reports: the new tab and each pane's old and new ID. */
export type MoveResult = {
  tab_id: string;
  panes: { previous: string; current: string }[];
};

/**
 * After World moves a tab to another workspace, strings follow it: pane
 * anchors take each pane's new ID (terminal witnesses are unchanged, since
 * moved panes keep their terminals) and tab anchors take the new tab ID.
 * Returns the strings that changed.
 */
export function followMove<
  S extends { id: string; from: BoardEnd; to: BoardEnd },
>(
  strings: readonly S[],
  connectionId: string,
  oldTabId: string,
  moved: MoveResult,
): S[] {
  const panes = new Map(
    moved.panes.map((pane) => [pane.previous, pane.current]),
  );
  const rewrite = (end: BoardEnd): BoardEnd => {
    if (!("anchor" in end) || end.anchor.connection_id !== connectionId)
      return end;
    const { anchor } = end;
    if (anchor.kind === "pane" && panes.has(anchor.native_id))
      return { anchor: { ...anchor, native_id: panes.get(anchor.native_id)! } };
    if (anchor.kind === "tab" && anchor.native_id === oldTabId)
      return { anchor: { ...anchor, native_id: moved.tab_id } };
    return end;
  };
  const changed: S[] = [];
  for (const string of strings) {
    const from = rewrite(string.from),
      to = rewrite(string.to);
    if (from !== string.from || to !== string.to)
      changed.push({ ...string, from, to });
  }
  return changed;
}
