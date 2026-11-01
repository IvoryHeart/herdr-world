import { useEffect, useRef, useState } from "react";
import { bridge } from "../../api";
import type { BinEntry, BinView } from "../../../../shared/bin";
import { paneCloseBlockReason, tabPinsFor } from "../../tabPins";
import type { BoardPane, BoardTab } from "../board/boardModel";
import { playBinSound } from "./binSounds";
import { useWorldBin, worldBinStore, type BinDrop } from "./binStore";
import { WorldBin, type BinDrag } from "./WorldBin";

export const UNREACHABLE_BIN_REASON =
  "This host can't be reached, so its agents can't be closed";

type Candidate = { tabKey: string; drop: BinDrop; drag: BinDrag };

/** What the bin would close for a tab card: the pane grabbed, else `fallback`. */
export function boardBinCandidate(
  tab: BoardTab,
  pane: BoardPane | undefined,
  view: BinView,
): Candidate | null {
  if (!pane) return null;
  const leaf = pane.leaf;
  const label = leaf.agentName || leaf.agentLabel || leaf.label || "Agent";
  const pinned = paneCloseBlockReason(
    leaf.nativeId,
    tab.panes.map((item) => ({
      pane_id: item.leaf.nativeId,
      tab_id: item.leaf.tabId,
    })),
    tabPinsFor(leaf.connectionId),
  );
  const refusal =
    leaf.stale || !leaf.actionable
      ? UNREACHABLE_BIN_REASON
      : pinned
        ? pinned.replace(/\.$/u, "")
        : null;
  return {
    tabKey: tab.key,
    drop: {
      connection_id: leaf.connectionId,
      connection_generation: leaf.generation,
      workspace_id: leaf.workspaceId,
      tab_id: leaf.tabId,
      pane_id: leaf.nativeId,
      terminal_id: leaf.terminalId,
      label,
      view,
    },
    drag: {
      label,
      refusal,
      working: pane.status === "working",
      keeps: Math.max(0, tab.panes.length - 1),
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

/**
 * Board and Desk's side of the bin: a card dragged over the plain bin goes in
 * when released; a waiting card stays in place, hidden, until it closes or
 * comes back out.
 */
export function useBoardBin({
  view,
  tabs,
  toast,
  cardEl,
  returned,
  changed,
}: {
  view: BinView;
  /** The tab cards shown now. */
  tabs: () => readonly BoardTab[];
  toast(text: string): void;
  cardEl(key: string): HTMLElement | undefined;
  /** A card came back out (dragged to `at`, a screen point, or by a button). */
  returned(tabKey: string, at: { x: number; y: number } | null): void;
  /** The bin changed: lines to hidden cards are drawn again. */
  changed(): void;
}) {
  const store = worldBinStore(bridge);
  const bin = useWorldBin(store);
  const carrying = useRef<Candidate | null>(null);
  /** The pane row a pointer went down on, so the bin closes that pane. */
  const pressed = useRef<string | undefined>(undefined);
  const hotRef = useRef(false);
  const [drag, setDrag] = useState<BinDrag | null>(null);
  const [hot, setHot] = useState(false);
  const [shake, setShake] = useState(0);
  const [home, setHome] = useState<string | null>(null);

  const binned = (pane: BoardPane) =>
    bin.entries.some(
      (entry) =>
        entry.connection_id === pane.leaf.connectionId &&
        entry.connection_generation === pane.leaf.generation &&
        entry.pane_id === pane.leaf.nativeId,
    );
  const tabOf = (entry: BinEntry) =>
    tabs().find((tab) =>
      tab.panes.some(
        (pane) =>
          pane.leaf.connectionId === entry.connection_id &&
          pane.leaf.generation === entry.connection_generation &&
          pane.leaf.nativeId === entry.pane_id,
      ),
    );

  const put = (candidate: Candidate) => {
    if (candidate.drag.refusal) {
      playBinSound("refuse");
      setShake((n) => n + 1);
      toast(`${candidate.drag.refusal}.`);
      return;
    }
    playBinSound("drop");
    void store
      .add(candidate.drop)
      .catch((error) =>
        toast(error instanceof Error ? error.message : String(error)),
      );
  };
  const paneFor = (tab: BoardTab, paneKey?: string) =>
    tab.panes.find((pane) => pane.key === paneKey) ??
    tab.panes.find((pane) => pane.isAgent) ??
    tab.panes[0];

  const changedRef = useRef(changed);
  changedRef.current = changed;
  useEffect(() => changedRef.current(), [bin.entries]);
  useEffect(() => () => void (carrying.current = null), []);

  return {
    /** A pointer went down on a card, on this pane row if any. */
    press(paneKey: string | undefined) {
      pressed.current = paneKey;
    },
    /** A tab card was lifted: the pane pressed is the one that would close. */
    lift(tab: BoardTab | undefined) {
      carrying.current = tab
        ? boardBinCandidate(tab, paneFor(tab, pressed.current), view)
        : null;
      hotRef.current = false;
      setDrag(carrying.current?.drag ?? null);
    },
    /** The carry moved: true while it is over the bin (and nothing else). */
    over(x: number, y: number) {
      const candidate = carrying.current;
      const next = Boolean(candidate) && overBin(x, y);
      if (next !== hotRef.current) {
        hotRef.current = next;
        setHot(next);
        if (candidate)
          cardEl(candidate.tabKey)?.classList.toggle(
            "board-over-bin",
            next && !candidate.drag.refusal,
          );
      }
      return next;
    },
    /** The carry ended: true when the bin took it (or refused it). */
    drop() {
      const candidate = carrying.current;
      const into = hotRef.current && candidate;
      carrying.current = null;
      hotRef.current = false;
      setHot(false);
      setDrag(null);
      if (candidate)
        cardEl(candidate.tabKey)?.classList.remove("board-over-bin");
      if (!into) return false;
      put(candidate);
      return true;
    },
    /** The selection bar's Close agent…: the visible twin of dragging. */
    closeAgent(tab: BoardTab, paneKey?: string) {
      const candidate = boardBinCandidate(tab, paneFor(tab, paneKey), view);
      if (candidate) put(candidate);
    },
    paneBinned: binned,
    /** Every pane of the tab waits in the bin: its card is hidden. */
    tabClass(tab: BoardTab) {
      if (!tab.panes.length || !tab.panes.every(binned)) return "";
      return home === tab.key ? "board-bin-home" : "board-binned";
    },
    element: (
      <WorldBin
        drag={drag}
        hot={hot}
        shake={shake}
        onDragOut={(entry) =>
          setHome(entry ? (tabOf(entry)?.key ?? null) : null)
        }
        onReturned={(entry, at) => {
          const key = tabOf(entry)?.key;
          if (key) returned(key, at);
        }}
      />
    ),
  };
}
