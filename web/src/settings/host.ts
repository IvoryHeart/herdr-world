/**
 * The host the Settings screen and the command box hand to entries (#1035).
 * The Menu builds it from what App gives it and publishes it here, so the
 * command box reads the same values without App passing them twice.
 */

import { useSyncExternalStore } from "react";
import type { SettingsHost } from "./registry";

let current: SettingsHost | null = null;
const listeners = new Set<() => void>();

export function publishSettingsHost(host: SettingsHost | null) {
  if (current === host) return;
  current = host;
  for (const listener of listeners) listener();
}

export function settingsHost() {
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSettingsHost() {
  return useSyncExternalStore(subscribe, settingsHost, settingsHost);
}

/** Asks the Menu to open Settings, at an entry or category if given. */
export const SETTINGS_OPEN_EVENT = "herdr-world:settings-open";

export function openSettings(target?: string) {
  window.dispatchEvent(
    new CustomEvent<string | undefined>(SETTINGS_OPEN_EVENT, {
      detail: target,
    }),
  );
}
