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
  type DeskPin,
} from "./board/boardDocument";
import { terminalColorKey, type TerminalColorTarget } from "./terminalColor";
import {
  currentCorePins,
  setCoreTabPinned,
  withCorePins,
  type CorePins,
} from "./corePins";
import { worldRuntimeStore } from "./runtimeStore";
import { endpointAnchors } from "../../../shared/hostGrouping";
import type { WorldLeafObject, WorldSpaceObject } from "./worldObject";

/**
 * Town desk pins, a view setting World's service keeps beside the terminal
 * colours (board-store.ts `desk_pins`), keyed like them by the tab's card key.
 * Pinned goes first, as in Herdr's apps: a pinned desk takes its room's first
 * seats (townLayout.ts), and its agents stay at it except to wait at
 * reception. The saved `cell` is no longer read; `rank` is the desk's place
 * among the pinned seats once the user reorders them on the rug. Spaces' tab
 * pins (close protection, in the browser) are separate. A herdr-core tab's pin
 * is its agents' pin in Herdr's apps (corePins.ts); World saves only its rank,
 * as Herdr's apps have no order for pins.
 */

export type DeskPins = Readonly<Record<string, DeskPin>>;

const NONE: DeskPins = Object.freeze({});

/**
 * The previous pins while the same desks are pinned in the same saved order,
 * so identity is stable.
 */
export function keepDeskPins(last: DeskPins, next: DeskPins): DeskPins {
  const keys = Object.keys(next);
  return keys.length === Object.keys(last).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(last, key) &&
        last[key]!.rank === next[key]!.rank,
    )
    ? last
    : next;
}

/** Each endpoint view's anchor, as World publishes it (`host_grouping`). */
const currentPinAnchors = () =>
  endpointAnchors(worldRuntimeStore.get().hostGrouping);

/**
 * Two connections of one Herdr endpoint (a startup default and a saved
 * profile of the same socket) show the same tabs, so a desk has one pin: it
 * is kept under the endpoint's anchor, the connection Town places the
 * endpoint's rooms by, and holds when another view takes over. Every other
 * view reads the anchor's pins under its own connection (views of one
 * endpoint share workspace and tab IDs), and writes go to the anchor
 * (`setDeskPinned`), so each pin control reads what it wrote.
 */
export function anchoredDeskPins(
  pins: DeskPins,
  anchors: ReadonlyMap<string, string>,
): DeskPins {
  let aliased: Record<string, DeskPin> | null = null;
  for (const [view, anchor] of anchors)
    for (const [key, pin] of Object.entries(pins))
      if (key.startsWith(`${anchor}:`)) {
        aliased ??= { ...pins };
        aliased[`${view}:${key.slice(anchor.length + 1)}`] = pin;
      }
  return aliased ?? pins;
}

/**
 * The desk pins Town shows, kept current from the World service: saved pins,
 * with each herdr-core tab pinned exactly when its agents' label says so,
 * read alike by every view of one endpoint (`anchoredDeskPins`).
 */
export function useDeskPins(
  store: BoardDocumentStore = sharedBoardStore(),
  corePins: () => CorePins = currentCorePins,
  anchors: () => ReadonlyMap<string, string> = currentPinAnchors,
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
      anchoredDeskPins(
        withCorePins(
          store.get().document?.layout.desk_pins ?? NONE,
          corePins(),
        ),
        anchors(),
      ),
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
 * Pin a tab's desk (it goes first in its room), or unpin it. A herdr-core
 * tab's pin is written to its agents' label in Herdr's apps; a Herdr tab's
 * is saved under its endpoint's anchor (`anchoredDeskPins`).
 */
export function setDeskPinned(
  target: TerminalColorTarget,
  pinned: boolean,
  store: BoardDocumentStore = sharedBoardStore(),
  corePins: CorePins = currentCorePins(),
  anchors: ReadonlyMap<string, string> = currentPinAnchors(),
) {
  const own = terminalColorKey(target);
  const core = corePins.get(own);
  const anchor = anchors.get(target.connectionId);
  const key = anchor
    ? terminalColorKey({ ...target, connectionId: anchor })
    : own;
  if (core) {
    // Unpinned here, its place on the rug goes too: pinned again, it joins
    // the end, as a Herdr desk does.
    if (!pinned && core.live && store.get().document?.layout.desk_pins?.[own])
      void store.patch([{ op: "desk.unpin", key: own }]);
    return setCoreTabPinned(core, pinned);
  }
  // Unpinning also clears a pin saved under this view itself.
  const ownPin =
    !pinned && own !== key && store.get().document?.layout.desk_pins?.[own];
  return store.patch([
    pinned ? { op: "desk.pin", key, cell: null } : { op: "desk.unpin", key },
    ...(ownPin ? [{ op: "desk.unpin" as const, key: own }] : []),
  ]);
}

/**
 * Save the order of a room's pinned desks (their tab card keys, front first)
 * as World's own Town layout; Herdr's apps have no order for pins. A
 * herdr-core tab gets a record for its place; a Herdr desk unpinned meanwhile
 * is not pinned again. Resolves with a conflict message, or null.
 */
export function saveDeskPinOrder(
  keys: readonly string[],
  store: BoardDocumentStore = sharedBoardStore(),
  corePins: CorePins = currentCorePins(),
) {
  return store.patch(
    keys.map((key, rank) =>
      corePins.has(key)
        ? { op: "desk.rank", key, rank, create: true }
        : { op: "desk.rank", key, rank },
    ),
  );
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
        title: "A pinned card goes first: it sits above its workspace on Board",
      },
      pinnedOf: (owner, tab) => board.pinned.has(keyOf(owner, tab)),
      onPin: (owner, tab) => toggleCard(keyOf(owner, tab)),
    };
  return {
    label: {
      pin: "Pin desk in Town",
      unpin: "Unpin desk in Town",
      title: "A pinned desk goes first in its room, and its agents stay at it",
    },
    pinnedOf: (owner, tab) => Boolean(deskPins[keyOf(owner, tab)]),
    onPin: (owner, tab, pinned) => void pinDesk(targetOf(owner, tab), pinned),
  };
}
