import type { createRevisionPublisher } from "../world/revision-publisher";
import type { ProfileStore } from "./profile-store";
import { TerminalSettings } from "./terminal-settings";
import type { PaneRow, SettingsLease } from "./terminal-tokens";

/** Lazy profile storage and the terminal-settings reconciler share one publisher. */
export function createProfileServices(
  publisher: ReturnType<typeof createRevisionPublisher>,
  registry: () => {
    readyRuntimeLease(id: string): SettingsLease | null;
    list(): readonly { id: string }[];
  },
  /** The service's profile store, opened on first use. */
  profiles: () => ProfileStore,
  /** The service clock. */
  now: () => number,
  log: (message: string) => void = console.warn,
) {
  let settings: TerminalSettings | null = null;
  const publishProfilesChanged = publisher(
    "world_profiles_changed",
    "world-profiles",
  );
  const terminalSettings = () =>
    (settings ??= new TerminalSettings(
      profiles(),
      (id) => registry().readyRuntimeLease(id),
      publishProfilesChanged,
      now,
      () =>
        registry()
          .list()
          .map(({ id }) => id),
    ));
  const observeTerminalSettings = (
    connectionId: string,
    generation: number,
    panes: readonly PaneRow[],
  ) => {
    void terminalSettings()
      .observe(connectionId, generation, panes)
      .catch((error) =>
        log(`Terminal settings reconciliation failed: ${String(error)}`),
      );
  };
  return {
    profiles,
    terminalSettings,
    publishProfilesChanged,
    observeTerminalSettings,
  };
}
