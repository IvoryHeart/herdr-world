import { useSyncExternalStore } from "react";
import { worldLocalStorage } from "../../browserStorage";
import {
  TOWN_RECEPTION_DEFAULT,
  TOWN_RECEPTION_SETTING_KEY,
  parseTownReceptionFilter,
  townReceptionIsDefault,
  type TownReceptionFilter,
} from "./townReceptionFilter";

/**
 * The reception filter as World stores it (townReceptionFilter.ts). The World
 * service holds the value and pushes changes to every other browser
 * (store/uiSettings.ts); this browser keeps a copy so a reload places agents
 * right before the socket answers. The server's value always wins.
 */

const CACHE_KEY = "townReception.v1";
type Send = (value: unknown) => Promise<void>;

let send: Send | null = null;
let filter: TownReceptionFilter | null = null;
/** The last value the server confirmed, restored when a write fails. */
let confirmed: TownReceptionFilter = TOWN_RECEPTION_DEFAULT;
let revision = 0;
const listeners = new Set<() => void>();

function cached(): TownReceptionFilter {
  try {
    const raw = worldLocalStorage.getItem(CACHE_KEY);
    return raw ? parseTownReceptionFilter(JSON.parse(raw)) : confirmed;
  } catch {
    return confirmed;
  }
}

function publish(next: TownReceptionFilter) {
  filter = next;
  try {
    worldLocalStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    /* The server copy still holds it. */
  }
  for (const listener of listeners) listener();
}

export function townReceptionFilter(): TownReceptionFilter {
  return (filter ??= cached());
}

/** The server's value: on connecting, and whenever another browser saves. */
export function adoptTownReceptionFilter(stored: unknown) {
  revision += 1;
  confirmed = parseTownReceptionFilter(stored);
  publish(confirmed);
}

/** The write path while the World socket is connected. */
export function connectTownReceptionFilter(next: Send | null) {
  send = next;
}

/**
 * Save a new filter for every browser. Shown here at once; when the service
 * refuses it, the last saved filter comes back and the error is thrown.
 */
export async function saveTownReceptionFilter(next: TownReceptionFilter) {
  const write = send;
  if (!write)
    throw new Error("Not connected to World; the reception filter is unsaved.");
  const current = ++revision;
  publish(next);
  try {
    // The default is stored as nothing, so a reset leaves no trace.
    await write(townReceptionIsDefault(next) ? undefined : next);
    if (current === revision) confirmed = next;
  } catch (error) {
    if (current === revision) publish(confirmed);
    throw error;
  }
}

export function useTownReceptionFilter(): TownReceptionFilter {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    townReceptionFilter,
    townReceptionFilter,
  );
}

export { TOWN_RECEPTION_SETTING_KEY };
