import { subscribeLocalStorage, worldLocalStorage } from "../../browserStorage";

export const BOARD_PULSES_KEY = "herdr-world.board.pulses";
const read = () => worldLocalStorage.getItem(BOARD_PULSES_KEY) !== "off";
let current: boolean | null = null;
const listeners = new Set<() => void>();
let unlisten: (() => void) | undefined;
let pageOnly = false;

export const boardPulses = () => (current ??= read());
function publish(next: boolean) {
  if (boardPulses() === next) return;
  current = next;
  for (const listener of listeners) listener();
}
export function setBoardPulses(next: boolean) {
  boardPulses();
  try {
    worldLocalStorage.setItem(BOARD_PULSES_KEY, next ? "on" : "off");
    pageOnly = false;
  } catch {
    pageOnly = true;
    // Storage refused: keep the page's choice.
  }
  publish(next);
}
export function subscribeBoardPulses(listener: () => void) {
  if (!listeners.size) {
    if (!pageOnly) publish(read());
    unlisten = subscribeLocalStorage((key) => {
      if (key === null || key === BOARD_PULSES_KEY) publish(read());
    });
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) unlisten?.();
  };
}
