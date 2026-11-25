import { bridge } from "../api";
import {
  adoptShortcutPreferences,
  connectShortcutPreferences,
  disconnectShortcutPreferences,
  SHORTCUT_SETTING_KEY,
} from "../shortcutPreferences";
import {
  TOWN_RECEPTION_SETTING_KEY,
  adoptTownReceptionFilter,
  connectTownReceptionFilter,
} from "../world/town/townReceptionSetting";
import {
  RUNTIME_GROUPING_SETTING_KEY,
  adoptRuntimeGrouping,
  connectRuntimeGrouping,
} from "../world/runtimeGrouping";

/**
 * Interface preferences from the World service (Roamgate #531). Preferences
 * are server-wide, not per Herdr connection. Their write path is installed
 * once per socket (`hello` or the connected status, whichever wins the race
 * on a fresh socket; a failed attempt leaves the flag clear so the other
 * retries). Their values reach every browser through World's one
 * publication (world.snapshot `ui_settings`, openspec world-one-object), the
 * same revision that carries topology. Values are bounded JSON with no
 * execution meaning (see bridge.ui_settings.* in the service).
 */
let uiSettingsHydrated = false;
let uiSettingsEpoch = 0;

/** The settings revision last adopted (the service's commit order). */
let adoptedRevision = -1;
const adoptedValues = new Map<string, string>();
/**
 * This browser's own writes per key: while one is in flight, or until a
 * publication carries its commit, an older published value is not adopted,
 * so the change never flashes back.
 */
const writes = new Map<string, { pending: number; after: number }>();

const ADOPTERS: ReadonlyArray<
  readonly [string, (value: unknown, revision: number) => void]
> = [
  [SHORTCUT_SETTING_KEY, (value) => adoptShortcutPreferences(value)],
  [TOWN_RECEPTION_SETTING_KEY, (value) => adoptTownReceptionFilter(value)],
  // Ordered by the service's revision and its own pending saves
  // (world/runtimeGrouping.ts).
  [RUNTIME_GROUPING_SETTING_KEY, adoptRuntimeGrouping],
];

/** Adopt published preferences no older than the last adopted ones. */
function adoptPublishedUiSettings(
  settings: { ui: Record<string, unknown>; revision: number } | undefined,
) {
  if (!settings || settings.revision < adoptedRevision) return;
  adoptedRevision = settings.revision;
  for (const [key, adopt] of ADOPTERS) {
    const write = writes.get(key);
    if (write && (write.pending > 0 || settings.revision < write.after))
      continue;
    const value = settings.ui[key] ?? null;
    const text = JSON.stringify(value);
    if (adoptedValues.get(key) === text) continue;
    adoptedValues.set(key, text);
    adopt(value, settings.revision);
  }
}

/** Follow World's publication (the shared replica) for preferences. */
export function followPublishedUiSettings(replica: {
  get(): { uiSettings?: { ui: Record<string, unknown>; revision: number } };
  subscribe(listener: () => void): () => unknown;
}) {
  const adopt = () => adoptPublishedUiSettings(replica.get().uiSettings);
  adopt();
  const off = replica.subscribe(adopt);
  return () => void off();
}

async function update(
  key: string,
  value: unknown,
  extra: Record<string, unknown> = {},
) {
  const write = writes.get(key) ?? { pending: 0, after: 0 };
  writes.set(key, write);
  write.pending += 1;
  try {
    const answer = await bridge.call("bridge.ui_settings.update", {
      key,
      value,
      ...extra,
    });
    if (typeof answer?.revision === "number")
      write.after = Math.max(write.after, answer.revision);
    return answer;
  } finally {
    write.pending -= 1;
  }
}

async function hydrateUiSettings() {
  if (uiSettingsHydrated) return;
  uiSettingsHydrated = true;
  const epoch = uiSettingsEpoch;
  try {
    const result = await bridge.call("bridge.ui_settings.get");
    if (epoch !== uiSettingsEpoch) return;
    const ui = (result?.ui as Record<string, unknown>) ?? {};
    const revision = typeof result?.revision === "number" ? result.revision : 0;
    // A newer publication may already have been adopted.
    const adopted = adoptedValues.get(SHORTCUT_SETTING_KEY);
    const shortcuts =
      revision < adoptedRevision && adopted !== undefined
        ? JSON.parse(adopted)
        : (ui[SHORTCUT_SETTING_KEY] ?? null);
    connectShortcutPreferences(async (preferences) => {
      await update(SHORTCUT_SETTING_KEY, preferences);
    }, shortcuts);
    adoptedValues.set(SHORTCUT_SETTING_KEY, JSON.stringify(shortcuts));
    connectTownReceptionFilter(async (value) => {
      await update(TOWN_RECEPTION_SETTING_KEY, value);
    });
    connectRuntimeGrouping(async (value, options) => {
      const answer = await update(
        RUNTIME_GROUPING_SETTING_KEY,
        value,
        options?.onlyIfAbsent ? { only_if_absent: true } : {},
      );
      return {
        value: answer?.value,
        revision:
          typeof answer?.revision === "number" ? answer.revision : undefined,
      };
    });
    // Adopting a missing grouping may offer this browser's older Town
    // choice, so the write paths are installed first.
    adoptPublishedUiSettings({ ui, revision });
  } catch {
    // Either the call lost a race with socket setup, or the service predates
    // the RPC. Clear the flag so the next trigger retries; the browser cache
    // keeps the bindings working meanwhile.
    if (epoch === uiSettingsEpoch) uiSettingsHydrated = false;
  }
}

export function installUiSettings(): void {
  bridge.onHello(() => void hydrateUiSettings());
  bridge.onStatus((status) => {
    if (status === "connected") void hydrateUiSettings();
    if (status === "disconnected") {
      uiSettingsEpoch += 1;
      uiSettingsHydrated = false;
      // A restarted service counts revisions afresh.
      adoptedRevision = -1;
      adoptedValues.clear();
      writes.clear();
      disconnectShortcutPreferences();
      connectTownReceptionFilter(null);
      connectRuntimeGrouping(null);
    }
  });
}
