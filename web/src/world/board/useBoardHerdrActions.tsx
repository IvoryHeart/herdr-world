/**
 * Town's actions on Board: rename and close a room (workspace) with Town's
 * dialogs, change Herdr's room and tab order (so Town and Spaces follow),
 * Mark reviewed, and a peek at an agent. Board's own card placement and Tidy
 * are untouched: these change Herdr, a drag changes only the Board, and the
 * bar says which is which.
 */

import {
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  herdrOrderNeighbor,
  requestTabStep,
  requestWorkspaceStep,
} from "../herdrOrder";
import { spaceRoomActionCapabilities } from "../officeRoomActions";
import { openCoreWorktrees } from "../CoreWorktrees";
import {
  closeCoreRoomConfirmed,
  closeRoom,
  renameRoom,
  RoomRenameCloseDialogs,
  type RoomRenameCloseTarget,
} from "../roomRenameClose";
import { sharedDeskStore, type WorldDeskStore } from "../deskStateStore";
import { useSystemBack } from "../../systemBack";
import { markReviewed, useReviewedWork } from "../useReviewedWork";
import { townPaneIdentity } from "../town/townChat";
import type { WorldLeafObject } from "../worldObject";
import type { BoardDocumentStore } from "./boardDocument";
import {
  boardKey,
  type BoardModel,
  type BoardPane,
  type BoardTab,
  type BoardWorkspace,
} from "./boardModel";
import { BoardPeek } from "./BoardPeek";

type Notify = (kind: "ok" | "error", text: string) => void;

type RoomDialog = {
  mode: "rename" | "close";
  workspaceKey: string;
  label: string;
  /** The room's connection and generation when the dialog opened. */
  target: RoomRenameCloseTarget;
};

/** The agent being peeked at; `pinned` when a tap opened it. */
type Peek = {
  leafId: string;
  anchor: { x: number; y: number };
  pinned: boolean;
};

const PEEK_DELAY_MS = 450;
const PEEK_LEAVE_MS = 320;

const STEP_WORD = { [-1]: "earlier", 1: "later" } as const;
const FOLLOW =
  "Town and Spaces follow; Board keeps its cards where you put them.";

/** An agent's name, as Board's cards show it. */
export const boardAgentName = (pane: BoardPane) =>
  pane.leaf.agentName ?? pane.leaf.agentLabel ?? "agent";

/** The pane a tab's bar acts on: the selected one, else its first agent. */
export function boardBarPane(
  tab: BoardTab,
  selectedId: string | null,
): BoardPane | undefined {
  return (
    tab.panes.find((pane) => pane.leaf.id === selectedId) ??
    tab.panes.find((pane) => pane.isAgent)
  );
}

/**
 * Town's saved spots for a host's rooms with two rooms' spots swapped, so
 * Town's reading order follows Herdr's after a step; null when Town has
 * not placed both rooms (it then stacks them in Herdr's order).
 */
export function swappedRoomSpots(
  pins: Readonly<Record<string, { x: number; y: number }>> | undefined,
  hostWorkspaceKeys: readonly string[],
  a: string,
  b: string,
): Record<string, { x: number; y: number }> | null {
  if (!pins?.[a] || !pins[b]) return null;
  const spots = Object.fromEntries(
    hostWorkspaceKeys
      .filter((key) => pins[key])
      .map((key) => [key, { ...pins[key]! }]),
  );
  spots[a] = { ...pins[b] };
  spots[b] = { ...pins[a] };
  return spots;
}

/**
 * Mark reviewed for an agent's finished work, shown while it waits for
 * review as Town and Needs you count it: done, or idle after a turn the
 * service saw end. It reads the reviewed record itself, so the service's
 * stop notices re-render only this button, not the Board.
 */
function BoardMarkReviewed({
  leaf,
  name,
  deskStore,
  notify,
}: {
  leaf: WorldLeafObject;
  name: string;
  deskStore: WorldDeskStore;
  notify: Notify;
}) {
  const work = useReviewedWork(deskStore);
  if (!work.toReview(leaf, Date.now())) return null;
  return (
    <button
      type="button"
      onClick={() =>
        void markReviewed(deskStore, leaf)
          .catch(() => false)
          .then((saved) =>
            notify(
              saved ? "ok" : "error",
              saved
                ? `${name}'s work reviewed`
                : `Could not save the review mark for ${name}. Try again when the connection is ready.`,
            ),
          )
      }
    >
      Mark reviewed
    </button>
  );
}

export function useBoardHerdrActions({
  model,
  selectedId,
  boardStore,
  boardRef,
  notify,
  onOpen,
  onOpenFiles,
  deskStore = sharedDeskStore(),
}: {
  model: BoardModel;
  selectedId: string | null;
  boardStore: BoardDocumentStore;
  boardRef: RefObject<HTMLDivElement | null>;
  notify: Notify;
  /** Open a pane as the user opens it: an agent's Chat, else its terminal. */
  onOpen(id: string): unknown;
  onOpenFiles?: (id: string) => unknown;
  /** The one reviewed record; World's shared Desk store by default. */
  deskStore?: WorldDeskStore;
}) {
  const [dialog, setDialog] = useState<RoomDialog | null>(null);
  const [moving, setMoving] = useState(false);
  const [peek, setPeek] = useState<Peek | null>(null);
  const panes = useMemo(() => {
    const byLeaf = new Map<string, { pane: BoardPane; tab: BoardTab }>();
    for (const tab of model.tabs)
      for (const pane of tab.panes) byLeaf.set(pane.leaf.id, { pane, tab });
    return byLeaf;
  }, [model]);
  const latest = useRef({ panes, peek });
  latest.current = { panes, peek };

  /* ---------- Hover: rest a mouse on an agent to peek at it ---------- */
  const hover = useRef({ id: null as string | null, held: false, timer: 0 });
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const state = hover.current;
    const leave = () => {
      window.clearTimeout(state.timer);
      state.id = null;
      state.timer = window.setTimeout(() => {
        if (!state.held && !latest.current.peek?.pinned) setPeek(null);
      }, PEEK_LEAVE_MS);
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.buttons) return;
      const target = event.target as HTMLElement;
      if (target.closest(".board-peek")) return;
      const node = target.closest<HTMLElement>("[data-world-node-anchor]");
      const id =
        node?.closest(".board-tab") && node.dataset.worldNodeAnchor
          ? node.dataset.worldNodeAnchor
          : null;
      const agent = id ? latest.current.panes.get(id)?.pane.isAgent : false;
      if (!agent) return void (state.id !== null || !id ? leave() : null);
      if (id === state.id) return;
      window.clearTimeout(state.timer);
      state.id = id;
      state.timer = window.setTimeout(() => {
        if (latest.current.peek?.pinned) return;
        const box = node!.getBoundingClientRect();
        setPeek({
          leafId: id!,
          anchor: { x: box.right, y: box.top + box.height / 2 },
          pinned: false,
        });
      }, PEEK_DELAY_MS);
    };
    // A press (a drag or a tap) puts a hover peek away.
    const down = (event: PointerEvent) => {
      if ((event.target as HTMLElement).closest(".board-peek")) return;
      window.clearTimeout(state.timer);
      state.id = null;
      if (!latest.current.peek?.pinned) setPeek(null);
    };
    el.addEventListener("pointerover", over);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("pointerdown", down, true);
    return () => {
      window.clearTimeout(state.timer);
      el.removeEventListener("pointerover", over);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("pointerdown", down, true);
    };
  }, [boardRef]);
  const peeked = peek ? panes.get(peek.leafId) : undefined;
  // The phone's Back closes the peek, then the dialogs, before leaving Board.
  useSystemBack(peek !== null, () => setPeek(null), "panel");
  useEffect(() => {
    if (peek && !peeked) setPeek(null);
  }, [peek, peeked]);

  /* ---------- Rooms: rename and close ---------- */
  const workspaceNow = (dialog: RoomDialog) => {
    const space = model.workspaceByKey.get(dialog.workspaceKey);
    return space &&
      space.connectionId === dialog.target.connectionId &&
      space.generation === dialog.target.generation &&
      spaceRoomActionCapabilities(space.space)[dialog.mode]
      ? space
      : null;
  };
  const openDialog = (mode: RoomDialog["mode"], space: BoardWorkspace) => {
    const target: RoomRenameCloseTarget = {
      connectionId: space.connectionId,
      generation: space.generation,
      workspaceId: space.nativeId,
      ...(spaceRoomActionCapabilities(space.space).core
        ? { core: true as const }
        : {}),
    };
    // A core room names every terminal that ends in its own confirmation.
    if (mode === "close" && target.core) {
      void closeCoreRoomConfirmed(target, space.label);
      return;
    }
    setDialog({ mode, workspaceKey: space.key, label: space.label, target });
  };

  /* ---------- Herdr's order ---------- */
  const run = async (label: string, move: () => Promise<string | null>) => {
    setMoving(true);
    try {
      const problem = await move();
      if (problem) notify("error", problem);
    } catch (cause) {
      notify("error", `${label} may not have moved: ${String(cause)}`);
    } finally {
      setMoving(false);
    }
  };
  const stepRoom = (space: BoardWorkspace, step: -1 | 1) =>
    run(space.label, async () => {
      const outcome = await requestWorkspaceStep(
        { connectionId: space.connectionId, generation: space.generation },
        space.nativeId,
        step,
      );
      if (outcome.status !== "moved")
        return `${space.label} not moved: ${outcome.message}`;
      const host = model.hostByKey.get(space.hostKey);
      const spots = outcome.neighbor
        ? swappedRoomSpots(
            boardStore.get().document?.layout.room_pins,
            host?.workspaceKeys ?? [],
            space.key,
            boardKey(space.connectionId, outcome.neighbor),
          )
        : null;
      const conflict = spots
        ? await boardStore.patch([
            { op: "room.place", connection_id: space.connectionId, spots },
          ])
        : null;
      if (conflict)
        return `${space.label} moved in Herdr, but Town may show the old order: ${conflict}`;
      notify(
        "ok",
        `Moved “${space.label}” ${STEP_WORD[step]} in Herdr. ${FOLLOW}`,
      );
      return null;
    });
  const stepTab = (tab: BoardTab, step: -1 | 1) => {
    const space = model.workspaceByKey.get(tab.workspaceKey);
    if (!space) return;
    void run(tab.label, async () => {
      const outcome = await requestTabStep(
        { connectionId: space.connectionId, generation: space.generation },
        tab.nativeId,
        step,
      );
      if (outcome.status !== "moved")
        return `${tab.label} not moved: ${outcome.message}`;
      notify(
        "ok",
        `Moved “${tab.label}” ${STEP_WORD[step]} in Herdr. ${FOLLOW}`,
      );
      return null;
    });
  };
  const orderButtons = (
    order: readonly string[],
    key: string,
    what: string,
    onStep: (step: -1 | 1) => void,
  ) => (
    <span
      className="board-herdr"
      role="group"
      aria-label={`${what} order in Herdr`}
    >
      <span
        className="board-herdr-label"
        title="Changes Herdr's order, which Town and Spaces show. Dragging a card moves it only on the Board."
      >
        Herdr order
      </span>
      {([-1, 1] as const).map((step) => (
        <button
          key={step}
          type="button"
          disabled={moving || !herdrOrderNeighbor(order, key, step)}
          title={`Move this ${what} ${STEP_WORD[step]} in Herdr; Town and Spaces follow`}
          onClick={() => onStep(step)}
        >
          {step < 0 ? "‹ Earlier" : "Later ›"}
        </button>
      ))}
    </span>
  );

  /** The selected card's Herdr actions, for its bar. */
  const barItems = (key: string): ReactNode => {
    const space = model.workspaceByKey.get(key);
    if (space) {
      const can = spaceRoomActionCapabilities(space.space);
      const host = model.hostByKey.get(space.hostKey);
      if (!can.rename && !can.close && !can.worktrees) return null;
      return (
        <>
          {can.worktrees ? (
            <button
              type="button"
              title="Worktrees: new, open or remove"
              onClick={() =>
                openCoreWorktrees({
                  connectionId: space.connectionId,
                  generation: space.generation,
                  workspaceId: space.nativeId,
                  label: space.label,
                  linked: can.linkedWorktree === true,
                })
              }
            >
              Worktrees…
            </button>
          ) : null}
          {can.rename ? (
            <button type="button" onClick={() => openDialog("rename", space)}>
              Rename…
            </button>
          ) : null}
          {can.close ? (
            <button
              type="button"
              className="board-danger"
              onClick={() => openDialog("close", space)}
            >
              Close…
            </button>
          ) : null}
          {can.rename && host && !can.core
            ? orderButtons(
                host.workspaceKeys,
                space.key,
                "room",
                (step) => void stepRoom(space, step),
              )
            : null}
        </>
      );
    }
    const tab = model.tabByKey.get(key);
    if (!tab) return null;
    const home = model.workspaceByKey.get(tab.workspaceKey);
    const pane = boardBarPane(tab, selectedId);
    const agent = pane?.isAgent ? pane : undefined;
    return (
      <>
        {agent ? (
          <button
            type="button"
            aria-pressed={peek?.leafId === agent.leaf.id}
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              setPeek(
                peek?.leafId === agent.leaf.id && peek.pinned
                  ? null
                  : {
                      leafId: agent.leaf.id,
                      anchor: { x: box.right, y: box.bottom },
                      pinned: true,
                    },
              );
            }}
          >
            Preview
          </button>
        ) : null}
        {agent ? (
          <BoardMarkReviewed
            leaf={agent.leaf}
            name={boardAgentName(agent)}
            deskStore={deskStore}
            notify={notify}
          />
        ) : null}
        {home && tab.actionable && !tab.stale
          ? orderButtons(home.tabKeys, tab.key, "tab", (step) =>
              stepTab(tab, step),
            )
          : null}
      </>
    );
  };

  const dialogs = (
    <RoomRenameCloseDialogs
      dialog={dialog}
      onClose={() => setDialog(null)}
      onRename={(label) => {
        const shown = dialog;
        setDialog(null);
        if (shown && workspaceNow(shown))
          void renameRoom(shown.target, shown.label, label);
      }}
      onConfirmClose={() => {
        const shown = dialog;
        setDialog(null);
        if (shown && workspaceNow(shown)) void closeRoom(shown.target);
      }}
    />
  );
  const overlay =
    peek && peeked ? (
      <BoardPeek
        // One card per agent session: a late reply result of another agent
        // never lands in this one.
        key={townPaneIdentity(peeked.pane.leaf)}
        target={{
          leaf: peeked.pane.leaf,
          name: boardAgentName(peeked.pane),
          where: `${peeked.tab.label} · ${model.workspaceByKey.get(peeked.tab.workspaceKey)?.label ?? ""}`,
          canReply: peeked.tab.actionable && !peeked.tab.stale,
          anchor: peek.anchor,
        }}
        notify={notify}
        deskStore={deskStore}
        onOpen={() => {
          setPeek(null);
          void onOpen(peeked.pane.leaf.id);
        }}
        onFiles={
          onOpenFiles
            ? () => {
                setPeek(null);
                void onOpenFiles(peeked.pane.leaf.id);
              }
            : undefined
        }
        onClose={() => setPeek(null)}
        onHold={(held) => {
          hover.current.held = held;
          window.clearTimeout(hover.current.timer);
          if (!held && !peek.pinned)
            hover.current.timer = window.setTimeout(
              () => setPeek(null),
              PEEK_LEAVE_MS,
            );
        }}
      />
    ) : null;

  return {
    barItems,
    /** Rename and close dialogs: outside the board, clear of its gestures. */
    dialogs,
    /** The peek: inside the board, in its colours. */
    overlay,
  };
}
