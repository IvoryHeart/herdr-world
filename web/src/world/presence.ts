import { useEffect, useSyncExternalStore } from "react";
import { bridge } from "../api";
import { worldLocalStorage } from "../browserStorage";
import { AWAY_MS, type AwayWindow } from "./sinceYouLeft";

/**
 * The owner's presence: when they last had a visible World tab with input,
 * and the latest return after 30 minutes or more away.
 *
 * Last seen lives in two places. The World service keeps one value for every
 * device (`world.presence.seen`, in memory), so working on one device is not
 * a return on another. This browser keeps its own copy, which also covers a
 * service restart. A return's window, the items opened since, and the ✕
 * that dismissed its lines stay in this browser only.
 */

export type OwnerReturn = AwayWindow & {
  /** Needs you items the owner has opened since returning. */
  opened: readonly string[];
};

export type PresenceSnapshot = {
  /** The latest return, if any. */
  away: OwnerReturn | null;
  /** ✕ cleared this return's recap lines. */
  dismissed: boolean;
};

type ServiceSeen = { previous: number | null; now: number };

export type PresenceDeps = {
  now(): number;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  /** Record a sighting on the service; its previous last seen, by its clock. */
  service(): Promise<ServiceSeen | null>;
};

const LAST_SEEN = "presence.lastSeen.v1";
const RETURN = "presence.return.v1";
const DISMISSED = "presence.dismissedUpTo.v1";
/** Input this soon after the last sighting changes nothing. */
const SIGHTING_MS = 10_000;
/** The service hears from a present browser at most this often. */
const SERVICE_MS = 60_000;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function parseServiceSeen(value: unknown): ServiceSeen | null {
  if (!value || typeof value !== "object") return null;
  const { previous, now } = value as Record<string, unknown>;
  if (!finite(now) || (previous !== null && !finite(previous))) return null;
  return { previous: previous as number | null, now };
}

export class OwnerPresence {
  #deps: PresenceDeps;
  #listeners = new Set<() => void>();
  #snapshot: PresenceSnapshot;
  #lastSighting = -Infinity;
  #lastService = -Infinity;
  #asking = false;
  /**
   * This browser's last seen as it was before this page wrote one: when the
   * owner was last here, for the Town Master's greeting.
   */
  readonly lastSeenBefore: number | null;

  constructor(deps: PresenceDeps) {
    this.#deps = deps;
    this.#snapshot = this.#read();
    this.lastSeenBefore = this.#number(LAST_SEEN);
  }

  get = () => this.#snapshot;

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /**
   * The owner is here: a visible tab, with input or just made visible. After
   * 30 minutes or more since the last sighting on this browser and on the
   * service, this starts a return.
   */
  async sighted(force = false): Promise<void> {
    const t = this.#deps.now();
    if (!force && t - this.#lastSighting < SIGHTING_MS) return;
    this.#lastSighting = t;
    const previous = this.#number(LAST_SEEN);
    this.#write(LAST_SEEN, String(t));
    const localAway = previous === null ? null : t - previous;
    const candidate = localAway === null || localAway >= AWAY_MS;
    if (this.#asking || (!candidate && t - this.#lastService < SERVICE_MS))
      return;
    this.#asking = true;
    this.#lastService = t;
    let seen: ServiceSeen | null = null;
    try {
      seen = await this.#deps.service();
    } catch {
      // Unreachable service: this browser's own last seen decides.
    } finally {
      this.#asking = false;
    }
    if (!candidate) return;
    const aways = [
      localAway,
      seen && seen.previous !== null ? seen.now - seen.previous : null,
    ].filter(finite);
    if (!aways.length) return;
    const away = Math.min(...aways);
    if (away >= AWAY_MS) this.begin({ since: t - away, at: t });
  }

  /**
   * A return: its window replaces any earlier one, with nothing opened. The
   * owner is seen at its end, so the next input does not start another.
   */
  begin(window: AwayWindow) {
    this.#write(
      LAST_SEEN,
      String(Math.max(window.at, this.#number(LAST_SEEN) ?? 0)),
    );
    this.#write(RETURN, JSON.stringify({ ...window, opened: [] }));
    this.#changed();
  }

  /** ✕: clears only this return's recap lines. */
  dismiss() {
    const away = this.#snapshot.away;
    if (!away) return;
    this.#write(DISMISSED, String(away.at));
    this.#changed();
  }

  /** The owner opened a Needs you item: its "new" dot goes. */
  opened(itemKey: string) {
    const away = this.#snapshot.away;
    if (!away || away.opened.includes(itemKey)) return;
    this.#write(
      RETURN,
      JSON.stringify({ ...away, opened: [...away.opened, itemKey] }),
    );
    this.#changed();
  }

  /** Another tab of this browser changed the stored state. */
  reload() {
    this.#changed();
  }

  #changed() {
    this.#snapshot = this.#read();
    for (const listener of this.#listeners) listener();
  }

  #read(): PresenceSnapshot {
    let away: OwnerReturn | null = null;
    try {
      const value = JSON.parse(
        this.#deps.storage.getItem(RETURN) ?? "null",
      ) as Record<string, unknown> | null;
      if (
        value &&
        finite(value.since) &&
        finite(value.at) &&
        value.since < value.at
      )
        away = {
          since: value.since,
          at: value.at,
          opened: Array.isArray(value.opened)
            ? value.opened.filter(
                (key): key is string => typeof key === "string",
              )
            : [],
        };
    } catch {
      away = null;
    }
    const dismissedUpTo = this.#number(DISMISSED);
    return {
      away,
      dismissed:
        away !== null && dismissedUpTo !== null && dismissedUpTo >= away.at,
    };
  }

  #number(key: string) {
    try {
      const value = Number(this.#deps.storage.getItem(key) ?? Number.NaN);
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }

  #write(key: string, value: string) {
    try {
      this.#deps.storage.setItem(key, value);
    } catch {
      // Private windows: presence lasts as long as the page.
    }
  }
}

/**
 * Testing only: `?awaySince=120` (minutes, or `2h`) pretends the owner left
 * that long ago. The parameter is removed at once, so a reload after ✕ keeps
 * the recap gone. It is not a user-facing control.
 */
export function awaySinceParam(search: string): number | null {
  const value = new URLSearchParams(search).get("awaySince");
  const match = value?.match(/^(\d{1,5})(m|h)?$/u);
  if (!match) return null;
  const amount = Number(match[1]);
  const ms = amount * (match[2] === "h" ? 3_600_000 : 60_000);
  return ms > 0 ? ms : null;
}

let shared: OwnerPresence | null = null;
let users = 0;
let stopShared: (() => void) | null = null;

export function sharedPresence() {
  return (shared ??= new OwnerPresence({
    now: () => Date.now(),
    storage: worldLocalStorage,
    service: async () =>
      parseServiceSeen(await bridge.call("world.presence.seen", {}, 5_000)),
  }));
}

/** Watch for the owner (input on a visible tab) while World runs. */
function watch(presence: OwnerPresence) {
  const visible = () => document.visibilityState === "visible";
  const onInput = () => {
    if (visible()) void presence.sighted();
  };
  const onVisibility = () => {
    if (visible()) void presence.sighted(true);
  };
  const onStorage = () => presence.reload();
  const inputs = ["pointerdown", "pointermove", "keydown", "wheel"] as const;
  for (const name of inputs)
    window.addEventListener(name, onInput, { capture: true, passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("storage", onStorage);
  const simulated = awaySinceParam(location.search);
  if (simulated !== null) {
    const at = Date.now();
    presence.begin({ since: at - simulated, at });
    const url = new URL(location.href);
    url.searchParams.delete("awaySince");
    history.replaceState(history.state, "", url);
  } else if (visible()) void presence.sighted(true);
  return () => {
    for (const name of inputs)
      window.removeEventListener(name, onInput, { capture: true });
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("storage", onStorage);
  };
}

/** Mounted once while World runs, whichever view shows. */
export function usePresenceWatch() {
  useEffect(() => {
    users += 1;
    if (users === 1) stopShared = watch(sharedPresence());
    return () => {
      users -= 1;
      if (users === 0) {
        stopShared?.();
        stopShared = null;
      }
    };
  }, []);
}

export function useOwnerPresence(presence = sharedPresence()) {
  return useSyncExternalStore(presence.subscribe, presence.get, presence.get);
}
