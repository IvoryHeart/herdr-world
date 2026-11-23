import { useSyncExternalStore } from "react";
import { worldLocalStorage } from "../browserStorage";
import { readOfficePreferences } from "./officePreferences";

/**
 * How World groups a machine's runtimes (Herdr TUI and herdr-core), the
 * "Group runtimes" setting (#1307): one group per machine, holding every
 * runtime World holds there, or one per runtime. Every view that groups by
 * where agents run reads this one value through one derivation
 * (worldHosts.ts `runtimeGroupKey` / `worldHostGroups`): Town's buildings,
 * the navigator and Desk's host summaries.
 *
 * The World service keeps the value in its settings (`ui.runtimeGrouping`)
 * and pushes changes to every other browser (store/uiSettings.ts); this
 * browser keeps a read-through copy so a reload groups right before the
 * socket answers. The server's value always wins.
 *
 * Before #1307 the choice was Town's own browser preference
 * (`officePreferences:v1` `townBuildings`). While the service has no value,
 * the first browser that connects sends its old choice once; once the
 * service holds a value, no browser's old choice is sent again.
 */
export type RuntimeGrouping = "machine" | "runtime";

export const RUNTIME_GROUPING_DEFAULT: RuntimeGrouping = "machine";
/** The namespace this setting occupies in the service's settings.json `ui`. */
export const RUNTIME_GROUPING_SETTING_KEY = "runtimeGrouping";
const CACHE_KEY = "runtimeGrouping.v1";

type Send = (value: RuntimeGrouping) => Promise<void>;

export function parseRuntimeGrouping(value: unknown): RuntimeGrouping | null {
  return value === "machine" || value === "runtime" ? value : null;
}

let send: Send | null = null;
let grouping: RuntimeGrouping | null = null;
/** The last value the server confirmed, restored when a write fails. */
let confirmed: RuntimeGrouping | null = null;
let revision = 0;
let confirmedRevision = 0;
const listeners = new Set<() => void>();

/** This browser's copy, else its pre-#1307 Town choice, else the default. */
function cached(): RuntimeGrouping {
  try {
    const stored = parseRuntimeGrouping(
      JSON.parse(worldLocalStorage.getItem(CACHE_KEY) ?? "null"),
    );
    if (stored) return stored;
  } catch {
    /* Fall back to the older preference. */
  }
  return readOfficePreferences(worldLocalStorage).townBuildings === "runtime"
    ? "runtime"
    : RUNTIME_GROUPING_DEFAULT;
}

function publish(next: RuntimeGrouping) {
  const changed = grouping !== next;
  grouping = next;
  try {
    worldLocalStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    /* The server copy still holds it. */
  }
  if (changed) for (const listener of listeners) listener();
}

export function runtimeGrouping(): RuntimeGrouping {
  return (grouping ??= cached());
}

export function subscribeRuntimeGrouping(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The write path while the World socket is connected. */
export function connectRuntimeGrouping(next: Send | null) {
  send = next;
}

/**
 * The server's value: on connecting, and whenever another browser saves.
 * When the server has none yet, this browser's choice stands and, if it is
 * not the default, is sent once so every browser shares it.
 */
export function adoptRuntimeGrouping(stored: unknown) {
  const value = parseRuntimeGrouping(stored);
  if (value) {
    confirmedRevision = ++revision;
    confirmed = value;
    publish(value);
    return;
  }
  const local = cached();
  publish(local);
  if (local !== RUNTIME_GROUPING_DEFAULT && send)
    void saveRuntimeGrouping(local).catch(() => {
      /* The next connection offers it again while the server has none. */
    });
}

/**
 * Save the grouping for every browser. Shown here at once; when the service
 * refuses it, the last saved value comes back and the error is thrown.
 */
export async function saveRuntimeGrouping(next: RuntimeGrouping) {
  const write = send;
  if (!write)
    throw new Error("Not connected to World; the runtime grouping is unsaved.");
  const current = ++revision;
  const before = confirmed ?? runtimeGrouping();
  publish(next);
  try {
    // Stored even when it is the default, so a browser's older Town choice
    // is never sent over it later.
    await write(next);
    if (current > confirmedRevision) {
      confirmedRevision = current;
      confirmed = next;
    }
  } catch (error) {
    if (current === revision) publish(confirmed ?? before);
    throw error;
  }
}

export function useRuntimeGrouping(): RuntimeGrouping {
  return useSyncExternalStore(
    subscribeRuntimeGrouping,
    runtimeGrouping,
    runtimeGrouping,
  );
}
