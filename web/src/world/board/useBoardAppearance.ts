import { useSyncExternalStore } from "react";
import { subscribeLocalStorage, worldLocalStorage } from "../../browserStorage";
import {
  BOARD_APPEARANCE_KEY,
  boardAppearance,
  type BoardAppearance,
} from "./boardAppearance";

function read() {
  try {
    return boardAppearance(
      JSON.parse(worldLocalStorage.getItem(BOARD_APPEARANCE_KEY) ?? "null"),
    );
  } catch {
    return boardAppearance(null);
  }
}

let current: BoardAppearance | null = null;
const listeners = new Set<() => void>();
let unlisten: (() => void) | undefined;
let pageOnly = false;

export const boardAppearanceSnapshot = () => (current ??= read());

function publish(next: BoardAppearance) {
  if (JSON.stringify(boardAppearanceSnapshot()) === JSON.stringify(next))
    return;
  current = next;
  for (const listener of listeners) listener();
}

export function setBoardAppearance(next: BoardAppearance) {
  const admitted = boardAppearance(next);
  // Load the previous value before persisting, so subscribers see the change.
  boardAppearanceSnapshot();
  try {
    worldLocalStorage.setItem(BOARD_APPEARANCE_KEY, JSON.stringify(admitted));
    pageOnly = false;
  } catch {
    pageOnly = true;
    // Storage refused: keep the page's choice.
  }
  publish(admitted);
}

export function subscribeBoardAppearance(listener: () => void) {
  if (!listeners.size) {
    // Reconcile changes made in another tab while there were no readers.
    if (!pageOnly) publish(read());
    unlisten = subscribeLocalStorage((key) => {
      if (key === null || key === BOARD_APPEARANCE_KEY) publish(read());
    });
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) unlisten?.();
  };
}

export function useBoardAppearance() {
  const appearance = useSyncExternalStore(
    subscribeBoardAppearance,
    boardAppearanceSnapshot,
  );
  return { appearance, change: setBoardAppearance };
}
