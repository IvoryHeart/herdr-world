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
import { RUNTIME_GROUPING_SETTING_KEY } from "../../../shared/hostGrouping";
import {
  adoptRuntimeGroupingSetting,
  connectRuntimeGroupingMigration,
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
/** The newest publication adopted; replayed for a key once its write ends. */
let latest: { ui: Record<string, unknown>; revision: number } | undefined;
/** Per key, the value last handed to its view (no-change suppression). */
const adoptedValues = new Map<string, string>();
/**
 * This browser's own writes per key: while one is in flight, or until a
 * publication carries its commit, an older published value is not adopted,
 * so the change never flashes back. A newer value skipped meanwhile is not
 * lost: the newest publication is applied when the write ends.
 */
const writes = new Map<string, { pending: number; after: number }>();

const ADOPTERS: ReadonlyArray<
  readonly [string, (value: unknown, revision: number) => void]
> = [
  [SHORTCUT_SETTING_KEY, (value) => adoptShortcutPreferences(value)],
  [TOWN_RECEPTION_SETTING_KEY, (value) => adoptTownReceptionFilter(value)],
  // Views read the grouping from the replica; this only offers a missing
  // value from the browser's older Town choice (world/runtimeGrouping.ts).
  [RUNTIME_GROUPING_SETTING_KEY, (value) => adoptRuntimeGroupingSetting(value)],
];

/** Hand one key's published value to its view, unless its own write holds it. */
function adoptKey(
  key: string,
  adopt: (value: unknown, revision: number) => void,
  settings: { ui: Record<string, unknown>; revision: number },
) {
  const write = writes.get(key);
  if (write && (write.pending > 0 || settings.revision < write.after)) return;
  const value = settings.ui[key] ?? null;
  const text = JSON.stringify(value);
  if (adoptedValues.get(key) === text) return;
  adoptedValues.set(key, text);
  adopt(value, settings.revision);
}

/** Adopt published preferences no older than the last adopted ones. */
function adoptPublishedUiSettings(
  settings: { ui: Record<string, unknown>; revision: number } | undefined,
) {
  if (!settings || settings.revision < adoptedRevision) return;
  adoptedRevision = settings.revision;
  latest = settings;
  for (const [key, adopt] of ADOPTERS) adoptKey(key, adopt, settings);
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
  // The view now shows this browser's value, not the one last adopted, so a
  // later publication of that earlier value must be applied again.
  adoptedValues.delete(key);
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
    // A publication skipped while the write was pending may be newer than
    // its commit: apply the newest confirmed value now (adoptKey still
    // refuses one older than the commit, which a later publication brings).
    const adopter = ADOPTERS.find(([known]) => known === key);
    if (write.pending === 0 && latest && adopter)
      adoptKey(key, adopter[1], latest);
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
    // The only grouping write a browser makes here: its older Town choice,
    // stored only while the service holds none. Explicit changes are World
    // commands (world/worldCommands.ts).
    connectRuntimeGroupingMigration((value) =>
      update(RUNTIME_GROUPING_SETTING_KEY, value, { only_if_absent: true }),
    );
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
      latest = undefined;
      adoptedValues.clear();
      writes.clear();
      disconnectShortcutPreferences();
      connectTownReceptionFilter(null);
      connectRuntimeGroupingMigration(null);
    }
  });
}
