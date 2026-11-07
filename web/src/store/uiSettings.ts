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

/**
 * Reads interface preferences from the World service and installs their write
 * path (Roamgate #531). Preferences are server-wide, not per Herdr connection,
 * so this runs once per socket rather than per connection selection. Both
 * `hello` and the connected status trigger it because either can win the race
 * on a fresh socket; a failed attempt leaves the flag clear so the other
 * retries. Values are bounded JSON with no execution meaning (see
 * bridge.ui_settings.* in the service).
 */
let uiSettingsHydrated = false;
let uiSettingsEpoch = 0;
let uiSettingsPushVersion = 0;
let latestShortcutPush: unknown;
let receptionPushVersion = 0;
let latestReceptionPush: unknown;

async function hydrateUiSettings() {
  if (uiSettingsHydrated) return;
  uiSettingsHydrated = true;
  const epoch = uiSettingsEpoch;
  const pushVersion = uiSettingsPushVersion;
  const receptionVersion = receptionPushVersion;
  try {
    const result = await bridge.call("bridge.ui_settings.get");
    if (epoch !== uiSettingsEpoch) return;
    const ui = (result?.ui as Record<string, unknown>) ?? {};
    connectShortcutPreferences(
      async (preferences) => {
        await bridge.call("bridge.ui_settings.update", {
          key: SHORTCUT_SETTING_KEY,
          value: preferences,
        });
      },
      pushVersion === uiSettingsPushVersion
        ? ui[SHORTCUT_SETTING_KEY]
        : latestShortcutPush,
    );
    connectTownReceptionFilter(async (value) => {
      await bridge.call("bridge.ui_settings.update", {
        key: TOWN_RECEPTION_SETTING_KEY,
        value,
      });
    });
    adoptTownReceptionFilter(
      receptionVersion === receptionPushVersion
        ? ui[TOWN_RECEPTION_SETTING_KEY]
        : latestReceptionPush,
    );
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
      disconnectShortcutPreferences();
      connectTownReceptionFilter(null);
    }
  });
  bridge.onUiSetting((push) => {
    if (push.key === TOWN_RECEPTION_SETTING_KEY) {
      receptionPushVersion += 1;
      latestReceptionPush = push.value;
      adoptTownReceptionFilter(push.value);
      return;
    }
    if (push.key !== SHORTCUT_SETTING_KEY) return;
    uiSettingsPushVersion += 1;
    latestShortcutPush = push.value;
    adoptShortcutPreferences(push.value);
  });
}
