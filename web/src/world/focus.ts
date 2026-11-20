import { useEffect, useSyncExternalStore } from "react";
import { bridge } from "../api";
import { worldLocalStorage } from "../browserStorage";
import { focusTestOn } from "./focusTest";
import {
  FOCUS_CHOICES,
  type FocusEnded,
  type FocusState,
  focusLength,
  parseFocusState,
} from "../../../shared/focus";

/**
 * The browser's view of the service's focus session (#1131, shared/focus.ts).
 * While it runs, chimes, toasts, browser notifications and the count on the
 * tab and app icon hold on this page (the service holds push); Town, marks
 * and Needs you keep showing everything. Code outside React reads
 * `focusHeld()`.
 */

type Snapshot = {
  state: FocusState | null;
  /** The service clock minus this browser's, so a skewed phone counts right. */
  offset: number;
  error: string | null;
};

let snapshot: Snapshot = { state: null, offset: 0, error: null };
const listeners = new Set<() => void>();
let users = 0;
let unlisten: (() => void)[] = [];
let endTimer: ReturnType<typeof setTimeout> | null = null;

function publish(next: Snapshot) {
  snapshot = next;
  armEnd();
  for (const listener of listeners) listener();
}

/** The service's clock, as near as this browser can tell. */
export const focusNow = () => Date.now() + snapshot.offset;

/** True while the session holds interruptions on this page. */
export function focusHeld(state = snapshot.state, now = focusNow()) {
  const session = state?.session;
  return Boolean(
    session && (session.ends_at === null || now < session.ends_at),
  );
}

/** Time left in ms; null when not focused or open-ended. */
export function focusRemaining(state = snapshot.state, now = focusNow()) {
  const ends = state?.session?.ends_at;
  return focusHeld(state, now) && ends != null ? Math.max(0, ends - now) : null;
}

/** At the end time, show it ended at once and ask for the recap. */
function armEnd() {
  if (endTimer) clearTimeout(endTimer);
  endTimer = null;
  const ends = snapshot.state?.session?.ends_at;
  if (ends == null || typeof window === "undefined") return;
  const wait = Math.max(0, ends - focusNow());
  // Timers longer than 24 days overflow; a session is at most 12 hours.
  endTimer = setTimeout(() => {
    endTimer = null;
    // A new snapshot, so views re-render with the session over.
    snapshot = { ...snapshot };
    for (const listener of listeners) listener();
    // The service publishes the end too; this covers a missed message.
    setTimeout(() => void refreshFocus(), 1_500);
  }, wait + 50);
}

/** Admit a reply from the service if it is not older than what we have. */
export function admitFocus(value: unknown, receivedAt = Date.now()) {
  const state = parseFocusState(value);
  if (!state) return;
  if (snapshot.state && state.revision < snapshot.state.revision) return;
  publish({
    state,
    offset: state.now ? state.now - receivedAt : 0,
    error: null,
  });
}

export async function refreshFocus() {
  try {
    admitFocus(await bridge.call("world.focus.get"));
  } catch (error) {
    publish({
      ...snapshot,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Keep the session current: on each change notice and on reconnect. */
export function startFocusSync() {
  users += 1;
  if (users === 1) {
    unlisten = [
      bridge.onControl((control) => {
        if (
          control.type === "world_focus_changed" &&
          (control.revision ?? 0) > (snapshot.state?.revision ?? -1)
        )
          void refreshFocus();
      }),
      bridge.onStatus((status) => {
        if (status === "connected") void refreshFocus();
      }),
    ];
    void refreshFocus();
  }
  return () => {
    users -= 1;
    if (users) return;
    for (const off of unlisten) off();
    unlisten = [];
  };
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const get = () => snapshot;

/** The session, kept current while mounted. Re-renders at its end. */
export function useFocus() {
  useEffect(() => startFocusSync(), []);
  return useSyncExternalStore(subscribe, get, get);
}

async function write(method: string, params?: Record<string, unknown>) {
  try {
    admitFocus(await bridge.call(method, params));
  } catch (error) {
    publish({
      ...snapshot,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/** Start (or change the length of) a focus session; null runs until ended. */
export const startFocus = (minutes: number | null) =>
  write("world.focus.start", { minutes });
/** End now, on every device. */
export const endFocus = () => write("world.focus.end");

/** The lengths offered here: 25, 45, 90 m and Until I stop (1 m in a test). */
export function focusChoices(): readonly (number | null)[] {
  return focusTestOn() ? [1, ...FOCUS_CHOICES] : FOCUS_CHOICES;
}

/* ----- The end: one chime and a recap, per device. ----- */

const CHIMED_KEY = "focusChimed";
const DISMISSED_KEY = "focusRecapDismissed";
/** An end older than this, first seen now, plays no chime. */
const CHIME_WINDOW_MS = 2 * 60_000;
/** The recap stays until cleared, for at most this long. */
export const RECAP_MS = 12 * 60 * 60_000;

/**
 * Whether this device should chime for the session that ended: only one that
 * reached its time (End now was a choice, not news), only once per device,
 * and only near its end, so a page opened hours later stays quiet.
 */
export function shouldChimeFocusEnd(
  last: FocusEnded | null,
  now: number,
  chimed: string | null,
) {
  return Boolean(
    last &&
      last.reason === "expired" &&
      last.id !== chimed &&
      now - last.ended_at < CHIME_WINDOW_MS,
  );
}

/** Claim the end chime for this device; false if another tab already did. */
export function claimFocusChime(id: string) {
  if (worldLocalStorage.getItem(CHIMED_KEY) === id) return false;
  worldLocalStorage.setItem(CHIMED_KEY, id);
  return true;
}
export const focusChimed = () => worldLocalStorage.getItem(CHIMED_KEY);

/** The ended session whose recap shows here, if not cleared or too old. */
export function focusRecapSession(
  state: FocusState | null,
  now: number,
  dismissed = worldLocalStorage.getItem(DISMISSED_KEY),
) {
  const last = state?.last;
  if (!last || focusHeld(state, now) || last.id === dismissed) return null;
  return now - last.ended_at < RECAP_MS ? last : null;
}
export function dismissFocusRecap(id: string) {
  worldLocalStorage.setItem(DISMISSED_KEY, id);
  snapshot = { ...snapshot };
  for (const listener of listeners) listener();
}

/** Tests: forget the session. */
export function resetFocusForTests(state: FocusState | null = null) {
  if (endTimer) clearTimeout(endTimer);
  endTimer = null;
  snapshot = { state, offset: 0, error: null };
  for (const listener of listeners) listener();
}

/* ----- Opening the controls from the ring, Menu and command box. ----- */

/** Opens the Focus dialog (FocusDialog.tsx) from any menu. */
export const WORLD_FOCUS_EVENT = "herdr-world:focus";
export const openFocus = () =>
  window.dispatchEvent(new Event(WORLD_FOCUS_EVENT));

/** A session reached its end on this device: Town shows its recap. */
export const FOCUS_RECAP_EVENT = "herdr-world:focus-recap";

/** "18 m left", "Until you stop"; null when not focused. */
export function focusLeftText(state = snapshot.state, now = focusNow()) {
  if (!focusHeld(state, now)) return null;
  const left = focusRemaining(state, now);
  return left === null ? "Until you stop" : `${focusLength(left)} left`;
}

/** Calls `listener` on every change to the session (the registry's rows). */
export const subscribeFocus = subscribe;
