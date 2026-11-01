import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { bridge } from "../../api";
import type { BinTarget } from "../../../../shared/bin";
import type { WorldLeafObject, WorldObject } from "../worldObject";
import type { BoardPane, BoardTab } from "../board/boardModel";
import { boardBinCandidate, overBin, stagedPaneKeys } from "./useBoardBin";
import { useWorldBin, worldBinStore } from "./binStore";
import { WorldBin } from "./WorldBin";
import "./deskBin.css";

/** Desk uses the same qualified pane/tab admission as Board, including shells. */
export function deskBinCandidate(
  world: WorldObject,
  leaf: WorldLeafObject,
  reservations: readonly BinTarget[],
  pins?: ReadonlySet<string>,
) {
  if (
    leaf.kind !== "agent" ||
    !leaf.connectionId ||
    !leaf.workspaceId ||
    !leaf.tabId ||
    !leaf.nativeId ||
    !leaf.terminalId
  )
    return null;
  const panes = world.leaves
    .filter(
      (item) =>
        item.connectionId === leaf.connectionId &&
        item.generation === leaf.generation &&
        item.workspaceId === leaf.workspaceId &&
        item.tabId === leaf.tabId,
    )
    .map(
      (item): BoardPane =>
        ({
          key: item.id,
          leaf: item,
          status: item.status,
          isAgent: item.kind === "agent",
        }) as BoardPane,
    );
  const pane = panes.find(
    (item) =>
      item.leaf.nativeId === leaf.nativeId &&
      item.leaf.terminalId === leaf.terminalId,
  );
  return boardBinCandidate(
    { key: leaf.id, panes } as BoardTab,
    pane,
    "desk",
    stagedPaneKeys(reservations),
    pins,
  );
}

/** Desk card actions and pointer carries share one bin and one drop revalidation. */
export function useDeskBin(world: WorldObject) {
  const store = worldBinStore(bridge);
  const state = useWorldBin(store);
  const latest = useRef(world);
  latest.current = world;
  const targets = useMemo(
    () => store.activeTargets(),
    [state.entries, state.closing, state.reservations, store],
  );
  const hidden = useCallback(
    (leaf: WorldLeafObject) =>
      targets.some(
        (target) =>
          target.connection_id === leaf.connectionId &&
          target.connection_generation === leaf.generation &&
          target.pane_id === leaf.nativeId &&
          target.terminal_id === leaf.terminalId,
      ),
    [targets],
  );
  const candidate = (leaf: WorldLeafObject) =>
    deskBinCandidate(latest.current, leaf, store.reservedTargets());
  const [carry, setCarry] = useState<{
    leaf: WorldLeafObject;
    x: number;
    y: number;
  } | null>(null);
  const [hot, setHot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gesture = useRef<{
    id: number;
    leaf: WorldLeafObject;
    x: number;
    y: number;
    lifted: boolean;
    timer?: number;
  } | null>(null);
  const suppressClick = useRef(false);
  const clear = () => {
    if (gesture.current?.timer) window.clearTimeout(gesture.current.timer);
    // Consume the click synthesized by this release only. A later intentional
    // card action must not be swallowed if the release produced no click.
    if (gesture.current?.lifted)
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    gesture.current = null;
    setCarry(null);
    setHot(false);
  };
  useEffect(
    () => () => {
      if (gesture.current?.timer) window.clearTimeout(gesture.current.timer);
      gesture.current = null;
    },
    [],
  );
  const put = (captured: WorldLeafObject) => {
    const current = latest.current.leaves.find(
      (leaf) =>
        leaf.id === captured.id &&
        leaf.connectionId === captured.connectionId &&
        leaf.generation === captured.generation &&
        leaf.nativeId === captured.nativeId &&
        leaf.terminalId === captured.terminalId,
    );
    const next = current ? candidate(current) : null;
    if (!next || next.drag.refusal || !store.get().verified) {
      setError(
        next?.drag.refusal ?? "That agent changed or its host is not ready.",
      );
      return;
    }
    setError(null);
    void store
      .add(next.drop)
      .catch((error) =>
        setError(error instanceof Error ? error.message : String(error)),
      );
  };
  const lift = () => {
    const current = gesture.current;
    if (!current) return;
    current.lifted = true;
    suppressClick.current = true;
    setCarry({ leaf: current.leaf, x: current.x, y: current.y });
  };
  const events = (leaf: WorldLeafObject) => ({
    onPointerDown(event: PointerEvent<HTMLElement>) {
      const control = (event.target as HTMLElement).closest(
        "button,a,input,textarea,summary",
      );
      if (control && !control.classList.contains("desk-row")) return;
      clear();
      suppressClick.current = false;
      gesture.current = {
        id: event.pointerId,
        leaf,
        x: event.clientX,
        y: event.clientY,
        lifted: false,
      };
      if (event.pointerType === "touch")
        gesture.current.timer = window.setTimeout(lift, 350);
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const current = gesture.current;
      if (!current || current.id !== event.pointerId) return;
      if (
        !current.lifted &&
        Math.hypot(event.clientX - current.x, event.clientY - current.y) > 8
      ) {
        if (event.pointerType === "touch") return clear();
        lift();
      }
      if (!current.lifted) return;
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        /* Synthetic fixtures have no native pointer capture. */
      }
      setCarry({ leaf: current.leaf, x: event.clientX, y: event.clientY });
      setHot(overBin(event.clientX, event.clientY));
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const current = gesture.current;
      if (!current || current.id !== event.pointerId) return;
      const drop = current.lifted && overBin(event.clientX, event.clientY);
      clear();
      if (drop) put(current.leaf);
    },
    onPointerCancel: clear,
    onLostPointerCapture: clear,
    onClickCapture(event: {
      detail: number;
      preventDefault(): void;
      stopPropagation(): void;
    }) {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      if (event.detail === 0) return;
      event.preventDefault();
      event.stopPropagation();
    },
  });
  const closeButton = (leaf: WorldLeafObject) => {
    const next = candidate(leaf);
    return (
      <button
        type="button"
        className="desk-bin-action"
        disabled={!next || !!next.drag.refusal || !state.verified}
        title={next?.drag.refusal ?? undefined}
        onClick={() => put(leaf)}
      >
        Close agent…
      </button>
    );
  };
  return {
    hidden,
    events,
    closeButton,
    element: (
      <>
        <WorldBin
          drag={carry ? (candidate(carry.leaf)?.drag ?? null) : null}
          hot={hot}
          className="world-bin-desk"
        />
        {carry ? (
          <div
            className="desk-bin-ghost"
            style={{ left: carry.x, top: carry.y }}
          >
            {carry.leaf.agentName || carry.leaf.label}
          </div>
        ) : null}
        {error ? (
          <p className="desk-bin-error" role="alert">
            {error}
          </p>
        ) : null}
      </>
    ),
  };
}
