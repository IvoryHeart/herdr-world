import { useSyncExternalStore } from "react";
import { worldLocalStorage } from "../browserStorage";
import { readOfficePreferences } from "./officePreferences";

/**
 * How World groups a machine's runtimes (Herdr TUI and herdr-core), the
 * "Group runtimes" setting (#1307): one group per machine, holding every
 * runtime World holds there, or one per runtime. Every view that groups by
 * where agents run reads this one value through one derivation
 * (worldHosts.ts `hostGroupOf` / `groupByRuntime`): Town's buildings, the
 * navigator, Desk's host summaries and Board's zones.
 *
 * The World service keeps the value in its settings (`ui.runtimeGrouping`)
 * and pushes changes to every other browser (store/uiSettings.ts); this
 * browser keeps a read-through copy so a reload groups right before the
 * socket answers. The service's value always wins: its answers and pushes
 * carry the service's commit revision, and the newest revision this browser
 * has seen is the value it settles on, whether it came as its own save's
 * acknowledgement or another browser's push.
 *
 * Before #1307 the choice was Town's own browser preference
 * (`officePreferences:v1` `townBuildings`). While the service has no value,
 * a browser that holds a non-default older choice offers it once per
 * connection as an only-if-absent write: the service stores it only if no
 * browser has saved a value meanwhile, and answers with the value it holds.
 */
export type RuntimeGrouping = "machine" | "runtime";

/** @internal */
export const RUNTIME_GROUPING_DEFAULT: RuntimeGrouping = "machine";
/** The namespace this setting occupies in the service's settings.json `ui`. */
export const RUNTIME_GROUPING_SETTING_KEY = "runtimeGrouping";
/** @internal */
export const RUNTIME_GROUPING_CACHE_KEY = "runtimeGrouping.v1";

/** The service's answer to a write: the value it holds, and its revision. */
type RuntimeGroupingAck = { value: unknown; revision?: number };
type RuntimeGroupingSend = (
  value: RuntimeGrouping,
  options?: { onlyIfAbsent?: boolean },
) => Promise<RuntimeGroupingAck>;

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

function parseRuntimeGrouping(value: unknown): RuntimeGrouping | null {
  return value === "machine" || value === "runtime" ? value : null;
}

/**
 * One browser's copy of the setting. The page has one (below); the
 * exhaustive schedule test (server/src/bridge/runtime-grouping-schedules.test.ts) runs several
 * against one service.
 * @internal
 */
export function createRuntimeGroupingPreference(storage: PreferenceStorage) {
  let send: RuntimeGroupingSend | null = null;
  /** What this browser's views show. */
  let shown: RuntimeGrouping | null = null;
  /** The service's value at the newest revision seen; null while it has none. */
  let confirmed: RuntimeGrouping | null = null;
  /** The newest service revision seen on this connection (-1: none yet). */
  let seen = -1;
  /** This browser's saves still awaiting the service's answer. */
  let pending = 0;
  /** What views showed before this browser's pending saves began. */
  let before: RuntimeGrouping | null = null;
  let migrating = false;
  const listeners = new Set<() => void>();

  /** This browser's copy, else its pre-#1307 Town choice, else the default. */
  function cached(): RuntimeGrouping {
    try {
      const stored = parseRuntimeGrouping(
        JSON.parse(storage.getItem(RUNTIME_GROUPING_CACHE_KEY) ?? "null"),
      );
      if (stored) return stored;
    } catch {
      /* Fall back to the older preference. */
    }
    return readOfficePreferences(storage).townBuildings === "runtime"
      ? "runtime"
      : RUNTIME_GROUPING_DEFAULT;
  }
  /** What views show once no save is pending. */
  const settled = () => confirmed ?? before ?? cached();

  function publish(next: RuntimeGrouping) {
    const changed = shown !== next;
    shown = next;
    try {
      storage.setItem(RUNTIME_GROUPING_CACHE_KEY, JSON.stringify(next));
    } catch {
      /* The server copy still holds it. */
    }
    if (changed) for (const listener of listeners) listener();
  }

  /**
   * Take the service's value if it is at least as new as any seen. A value
   * without a revision (an older service) counts as the newest.
   */
  function observe(stored: unknown, revision: number | undefined): boolean {
    const at = typeof revision === "number" ? revision : seen + 1;
    if (at < seen) return false;
    seen = at;
    confirmed = parseRuntimeGrouping(stored);
    return true;
  }

  function migrate() {
    const local = cached();
    const write = send;
    if (migrating || !write || local === RUNTIME_GROUPING_DEFAULT) return;
    migrating = true;
    write(local, { onlyIfAbsent: true })
      .then((ack) => {
        if (observe(ack.value, ack.revision) && pending === 0)
          publish(settled());
      })
      .catch(() => {
        /* The next connection offers it again while the service has none. */
      })
      .finally(() => {
        migrating = false;
      });
  }

  return {
    current(): RuntimeGrouping {
      return (shown ??= cached());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /**
     * The write path while the World socket is connected; null when it
     * closes, which also forgets its revisions (a restarted service counts
     * again from zero).
     */
    connect(next: RuntimeGroupingSend | null) {
      send = next;
      if (!next) seen = -1;
    },
    /**
     * The service's value with its revision: on connecting, and whenever
     * another browser saves. When the service has none, this browser's
     * older choice is offered once (only if absent).
     */
    adopt(stored: unknown, revision?: number) {
      if (!observe(stored, revision)) return;
      if (pending === 0) publish(settled());
      if (confirmed === null) migrate();
    },
    /**
     * Save the grouping for every browser. Shown here at once; once every
     * save of this browser is answered, it shows the newest value the
     * service holds. A refused save is thrown.
     */
    async save(next: RuntimeGrouping) {
      const write = send;
      if (!write)
        throw new Error(
          "Not connected to World; the runtime grouping is unsaved.",
        );
      if (pending === 0) before = shown ?? cached();
      pending += 1;
      publish(next);
      try {
        // Stored even when it is the default, so a browser's older Town
        // choice is never stored over it later.
        const ack = await write(next);
        observe(ack.value, ack.revision);
      } finally {
        pending -= 1;
        if (pending === 0) {
          publish(settled());
          before = null;
        }
      }
    },
  };
}

const page = createRuntimeGroupingPreference(worldLocalStorage);

export const runtimeGrouping = () => page.current();
export const subscribeRuntimeGrouping = page.subscribe;
export const connectRuntimeGrouping = page.connect;
export const adoptRuntimeGrouping = page.adopt;
export const saveRuntimeGrouping = page.save;

export function useRuntimeGrouping(): RuntimeGrouping {
  return useSyncExternalStore(
    subscribeRuntimeGrouping,
    runtimeGrouping,
    runtimeGrouping,
  );
}
