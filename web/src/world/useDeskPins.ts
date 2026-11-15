import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import type { TabPinControl } from "../components/MobileControls";
import { useBoardCardPins, type BoardCardPins } from "./board/boardCardPins";
import {
  sharedBoardStore,
  type BoardDocumentStore,
  type DeskCell,
  type DeskPin,
} from "./board/boardDocument";
import { terminalColorKey, type TerminalColorTarget } from "./terminalColor";
import {
  currentCorePins,
  setCoreTabPinned,
  unpinnedCorePositions,
  useCorePins,
  withCorePins,
  type CorePins,
} from "./corePins";
import { worldRuntimeStore } from "./runtimeStore";
import type { WorldLeafObject, WorldSpaceObject } from "./worldObject";

/**
 * Town desk pins, a view setting World's service keeps beside the terminal
 * colours (board-store.ts `desk_pins`), keyed like them by the tab's card key.
 * A pinned desk keeps its cell, and its agents stay at it except to wait at
 * reception. Spaces' tab pins (close protection, in the browser) are separate.
 * A herdr-core tab's pin is its agents' pin in Herdr's apps (corePins.ts):
 * World keeps only its cell.
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

/**
 * The desk pins Town shows, kept current from the World service: saved pins,
 * with each herdr-core tab pinned exactly when its agents' label says so.
 */
export function useDeskPins(
  store: BoardDocumentStore = sharedBoardStore(),
  corePins: () => CorePins = currentCorePins,
): DeskPins {
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const subscribe = useCallback(
    (listener: () => void) => {
      const board = store.subscribe(listener);
      const runtime = worldRuntimeStore.subscribe(listener);
      return () => {
        board();
        runtime();
      };
    },
    [store],
  );
  const last = useRef<DeskPins>(NONE);
  const snapshot = () => {
    last.current = keepDeskPins(
      last.current,
      withCorePins(store.get().document?.layout.desk_pins ?? NONE, corePins()),
    );
    return last.current;
  };
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * Whether a leaf is pinned, for lists World shows in no order of its own,
 * which put pinned ones first as Herdr's apps do: a herdr-core leaf by its own
 * label, a Herdr leaf by its tab's desk.
 */
export function leafPinnedBy(
  deskPins: DeskPins,
  spaces: readonly WorldSpaceObject[],
) {
  return (node: WorldLeafObject) =>
    node.runtime === "herdr-core"
      ? node.pane.favourite === true
      : Boolean(
          deskPins[
            terminalColorKey({
              connectionId: node.connectionId,
              workspaceId: node.workspaceId,
              tabId: node.tabId,
              workspaceIds: new Set(
                spaces
                  .filter((space) => space.connectionId === node.connectionId)
                  .map((space) => space.nativeId),
              ),
            })
          ],
        );
}

/**
 * Pin a tab's desk where it is (Town fills in the cell), or unpin it. A
 * herdr-core tab's pin is written to its agents' label in Herdr's apps.
 */
export function setDeskPinned(
  target: TerminalColorTarget,
  pinned: boolean,
  store: BoardDocumentStore = sharedBoardStore(),
  corePins: CorePins = currentCorePins(),
) {
  const key = terminalColorKey(target);
  const core = corePins.get(key);
  if (core) return setCoreTabPinned(core, pinned);
  return store.patch([
    pinned ? { op: "desk.pin", key, cell: null } : { op: "desk.unpin", key },
  ]);
}

/**
 * Drops the saved cell of each herdr-core desk World now sees unpinned (an
 * app unpinned it), so pinning it again starts where it stands then. Mounted
 * once, at World's root.
 */
export function useCoreDeskPinPositions(
  store: BoardDocumentStore = sharedBoardStore(),
) {
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const saved = useSyncExternalStore(
    store.subscribe,
    () => store.get().document?.layout.desk_pins ?? NONE,
    () => store.get().document?.layout.desk_pins ?? NONE,
  );
  const core = useCorePins();
  const sent = useRef(new Set<string>());
  useEffect(() => {
    const drop = unpinnedCorePositions(Object.keys(saved), core).filter(
      (key) => !sent.current.has(key),
    );
    for (const key of [...sent.current])
      if (!Object.prototype.hasOwnProperty.call(saved, key))
        sent.current.delete(key);
    if (!drop.length) return;
    for (const key of drop) sent.current.add(key);
    void store
      .patch(drop.map((key) => ({ op: "desk.unpin", key }) as const))
      .catch(() => {
        for (const key of drop) sent.current.delete(key);
      });
  }, [saved, core, store]);
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

/**
 * Record the cell Town gave a pinned desk that had none yet. A saved pin is
 * only filled, never made (an unpin in between wins); a herdr-core desk its
 * label pins has no saved pin until Town places it.
 */
export function placeDeskPin(
  key: string,
  cell: DeskCell,
  store: BoardDocumentStore = sharedBoardStore(),
  corePins: CorePins = currentCorePins(),
) {
  const saved = store.get().document?.layout.desk_pins ?? NONE;
  return store.patch([
    corePins.get(key)?.pinned &&
    !Object.prototype.hasOwnProperty.call(saved, key)
      ? { op: "desk.pin", key, cell }
      : { op: "desk.place", key, cell },
  ]);
}
