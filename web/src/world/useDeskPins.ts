import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { TabPinControl } from "../components/MobileControls";
import { useBoardCardPins, type BoardCardPins } from "./board/boardCardPins";
import {
  sharedBoardStore,
  type BoardDocumentStore,
  type DeskCell,
  type DeskPin,
} from "./board/boardDocument";
import { terminalColorKey, type TerminalColorTarget } from "./terminalColor";

/**
 * Town desk pins, a view setting World's service keeps beside the terminal
 * colours (board-store.ts `desk_pins`), keyed like them by the tab's card key.
 * A pinned desk keeps its cell, and its agents stay at it except to wait at
 * reception. Spaces' tab pins (close protection, in the browser) are separate.
 */

export type DeskPins = Readonly<Record<string, DeskPin>>;

const NONE: DeskPins = Object.freeze({});

/** The previous pins while none changed, so their identity is stable. */
export function keepDeskPins(last: DeskPins, next: DeskPins): DeskPins {
  const keys = Object.keys(next);
  const same = (a: DeskPin | undefined, b: DeskPin) =>
    a !== undefined &&
    a.cell?.col === b.cell?.col &&
    a.cell?.row === b.cell?.row;
  return keys.length === Object.keys(last).length &&
    keys.every((key) => same(last[key], next[key]!))
    ? last
    : next;
}

/** The saved desk pins, kept current from the World service. */
export function useDeskPins(
  store: BoardDocumentStore = sharedBoardStore(),
): DeskPins {
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const last = useRef<DeskPins>(NONE);
  const snapshot = () => {
    last.current = keepDeskPins(
      last.current,
      store.get().document?.layout.desk_pins ?? NONE,
    );
    return last.current;
  };
  return useSyncExternalStore(store.subscribe, snapshot, snapshot);
}

/** Pin a tab's desk where it is (Town fills in the cell), or unpin it. */
export function setDeskPinned(
  target: TerminalColorTarget,
  pinned: boolean,
  store: BoardDocumentStore = sharedBoardStore(),
) {
  const key = terminalColorKey(target);
  return store.patch([
    pinned ? { op: "desk.pin", key, cell: null } : { op: "desk.unpin", key },
  ]);
}

/**
 * The phone terminal's pin (MobileControls.tsx): the tab's card while Board
 * shows, whose card bar the terminal covers there; otherwise its Town desk.
 */
export function useWorldTabPin(): TabPinControl {
  const deskPins = useDeskPins();
  const board = useBoardCardPins();
  return useMemo(() => worldTabPin(deskPins, board), [deskPins, board]);
}

export function worldTabPin(
  deskPins: DeskPins,
  board: BoardCardPins,
  pinDesk: typeof setDeskPinned = setDeskPinned,
): TabPinControl {
  const targetOf = (
    ...[owner, tab]: Parameters<TabPinControl["pinnedOf"]>
  ): TerminalColorTarget => ({
    connectionId: owner.connectionId,
    workspaceId: tab.workspace_id,
    tabId: tab.tab_id,
    workspaceIds: new Set(owner.workspaceIds),
  });
  const keyOf = (...args: Parameters<TabPinControl["pinnedOf"]>) =>
    terminalColorKey(targetOf(...args));
  const toggleCard = board.toggle;
  if (toggleCard)
    return {
      label: {
        pin: "Pin card on Board",
        unpin: "Unpin card on Board",
        title: "A pinned card keeps its place on Board until you drag it",
      },
      pinnedOf: (owner, tab) => board.pinned.has(keyOf(owner, tab)),
      onPin: (owner, tab) => toggleCard(keyOf(owner, tab)),
    };
  return {
    label: {
      pin: "Pin desk in Town",
      unpin: "Unpin desk in Town",
      title: "A pinned desk keeps its place in Town, and its agents stay at it",
    },
    pinnedOf: (owner, tab) => Boolean(deskPins[keyOf(owner, tab)]),
    onPin: (owner, tab, pinned) => void pinDesk(targetOf(owner, tab), pinned),
  };
}

/** Record the cell Town gave a pinned desk that had none yet. */
export function placeDeskPin(
  key: string,
  cell: DeskCell,
  store: BoardDocumentStore = sharedBoardStore(),
) {
  return store.patch([{ op: "desk.place", key, cell }]);
}
