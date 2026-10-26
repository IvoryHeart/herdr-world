import { createUpdateNotificationHistory } from "../updateNotifications";
import { worldLocalStorage, worldSessionStorage } from "../browserStorage";
import {
  set,
  wait,
  state,
  catalogReadyForConnection,
  refreshBridgeStatus,
  store,
} from "../store";
import {
  scheduleRefresh,
  refreshTimers,
  queuedConnectionKeys,
} from "./refresh";
import { type UpdateInfo } from "./types";
import {
  TASK_NOTIFICATIONS_KEY,
  TASK_NOTIFICATION_PREFERENCES_KEY,
  storedTaskNotificationsEnabled,
  storedTaskNotificationPreferences,
} from "./notifications";

const updateNotifications = createUpdateNotificationHistory(worldLocalStorage);

const AUTOMATIC_UPDATE_CHECKS_KEY = "automaticUpdateChecksEnabled";
const PENDING_UPDATE_RELOAD_KEY = "pendingUpdateReloadVersion";
// Set when a World update reloads the page, so the new release then upgrades
// Herdr as its own visible step.
const PENDING_HERDR_UPGRADE_KEY = "pendingHerdrUpgrade";
const UPDATE_RESTART_VERIFY_TIMEOUT_MS = 90 * 1000;
const UPDATE_RESTART_VERIFY_INTERVAL_MS = 750;

export function automaticUpdateChecksEnabledFromStorage(
  storage: Pick<Storage, "getItem"> | undefined,
): boolean {
  try {
    return storage?.getItem(AUTOMATIC_UPDATE_CHECKS_KEY) !== "false";
  } catch {
    return true;
  }
}

function storedAutomaticUpdateChecksEnabled(): boolean {
  return automaticUpdateChecksEnabledFromStorage(
    typeof localStorage === "undefined" ? undefined : worldLocalStorage,
  );
}

function storedPendingRestartVersion(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    return worldSessionStorage.getItem(PENDING_UPDATE_RELOAD_KEY);
  } catch {
    return null;
  }
}

function markPendingHerdrUpgrade() {
  try {
    worldSessionStorage.setItem(PENDING_HERDR_UPGRADE_KEY, "1");
  } catch {
    // Without storage the upgrade stays available from the menu.
  }
}

function consumePendingHerdrUpgrade(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    const pending = worldSessionStorage.getItem(PENDING_HERDR_UPGRADE_KEY);
    worldSessionStorage.removeItem(PENDING_HERDR_UPGRADE_KEY);
    return pending === "1";
  } catch {
    return false;
  }
}

/** The Herdr status payload's upgrade offer, from /api/herdr/status. */
export interface HerdrStatusUpgrade {
  state:
    | "missing"
    | "current"
    | "newer"
    | "outdated"
    | "package-managed"
    | "unknown";
  version?: string;
  command?: string;
  /** Harness integrations and `ivoryheart.herdr-world` still to update. */
  pending?: string[];
  server_outdated?: boolean;
}

const WORLD_PLUGIN_ID = "ivoryheart.herdr-world";

function statusUpgrade(status: unknown): HerdrStatusUpgrade | null {
  if (!status || typeof status !== "object") return null;
  const upgrade = (status as { upgrade?: unknown }).upgrade;
  return upgrade && typeof upgrade === "object"
    ? (upgrade as HerdrStatusUpgrade)
    : null;
}

/**
 * Whether Herdr World should offer its Herdr step: Herdr or its running
 * server is behind the verified release, or this World release still has
 * harness integrations or its plugin to bring up to date.
 */
export function herdrUpgradeOffered(status: unknown): boolean {
  const upgrade = statusUpgrade(status);
  return (
    upgrade?.state === "outdated" ||
    upgrade?.server_outdated === true ||
    (upgrade?.pending?.length ?? 0) > 0
  );
}

/** The menu entry for the Herdr step, given a status that offers it. */
export function herdrUpgradeMenuEntry(status: {
  version?: string;
  verified_version?: string;
  upgrade?: HerdrStatusUpgrade;
}): { label: string; description: string } {
  const upgrade = status.upgrade;
  if (upgrade?.state === "outdated" || upgrade?.server_outdated) {
    const from =
      upgrade.state === "outdated" ? upgrade.version : status.version;
    return {
      label: `Upgrade Herdr to ${status.verified_version}`,
      description: `Herdr ${from} is installed or running; this release verified ${status.verified_version}`,
    };
  }
  const names = (upgrade?.pending ?? []).map((item) =>
    item === WORLD_PLUGIN_ID
      ? "Herdr World plugin"
      : `${item} harness integration`,
  );
  return {
    label: "Update Herdr integrations",
    description: `For this release: ${names.join(", ")}`,
  };
}

function storePendingRestartVersion(version: string | null) {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (version) {
      worldSessionStorage.setItem(PENDING_UPDATE_RELOAD_KEY, version);
    } else {
      worldSessionStorage.removeItem(PENDING_UPDATE_RELOAD_KEY);
    }
  } catch {
    // Storage may be unavailable in private or restricted browser contexts.
  }
}

export function healthMatchesUpdateVersion(
  health: unknown,
  expectedVersion: string,
): boolean {
  return (
    typeof health === "object" &&
    health !== null &&
    "version" in health &&
    (health as { version?: unknown }).version === expectedVersion
  );
}
let updateReloadVerification: {
  version: string;
  promise: Promise<void>;
} | null = null;

function redirectToLogin() {
  const loginUrl = new URL("/login", window.location.origin);
  window.location.replace(loginUrl.href);
}

/**
 * Keep the old frontend alive until the supervisor starts the updated process
 * and it serves the expected version. The session marker survives a manual
 * reload during the restart window and is cleared before the automatic reload.
 */
function reloadWhenUpdatedServerIsReady(
  expectedVersion: string,
): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (updateReloadVerification?.version === expectedVersion) {
    return updateReloadVerification.promise;
  }

  const promise = (async () => {
    const deadline = Date.now() + UPDATE_RESTART_VERIFY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`/api/health?t=${Date.now()}`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (response.status === 401) {
          storePendingRestartVersion(null);
          set({ pendingRestartVersion: null });
          redirectToLogin();
          return;
        }
        if (response.ok) {
          const health = await response.json().catch(() => null);
          if (healthMatchesUpdateVersion(health, expectedVersion)) {
            storePendingRestartVersion(null);
            markPendingHerdrUpgrade();
            set({
              pendingRestartVersion: null,
              notice: {
                kind: "success",
                message: `Herdr World ${expectedVersion} is running`,
                detail:
                  "Reloading the application to use the updated frontend.",
                loading: true,
              },
            });
            window.location.reload();
            return;
          }
        }
      } catch {
        // The bridge is expected to be briefly unavailable during replacement.
      }
      await wait(UPDATE_RESTART_VERIFY_INTERVAL_MS);
    }

    storePendingRestartVersion(null);
    set({
      pendingRestartVersion: null,
      notice: {
        kind: "error",
        message: "Updated server did not become ready",
        detail: `Could not verify Herdr World ${expectedVersion}. Reload the page after checking the server process.`,
      },
    });
  })().finally(() => {
    if (updateReloadVerification?.promise === promise) {
      updateReloadVerification = null;
    }
  });
  updateReloadVerification = { version: expectedVersion, promise };
  return promise;
}

let metadataTimer: ReturnType<typeof setInterval> | null = null;
let updateTimer: ReturnType<typeof setInterval> | null = null;

// Push events and post-action refreshes carry live updates; the metadata poll
// is only a backstop, so it can run slowly and skip ticks while hidden.
const METADATA_POLL_MS = 5000;

function startMetadataPolling() {
  if (metadataTimer) return;
  metadataTimer = setInterval(() => {
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    ) {
      return;
    }
    if (state.status === "connected") {
      if (catalogReadyForConnection) scheduleRefresh();
      void refreshBridgeStatus();
    }
  }, METADATA_POLL_MS);
}

async function checkForUpdate(showErrors = false) {
  if (!showErrors && !state.automaticUpdateChecksEnabled) return;
  if (state.connectionPaused) {
    if (showErrors) {
      set({
        notice: {
          kind: "info",
          message: "Connection is paused",
          detail: "Resume the connection before checking for updates.",
        },
      });
    }
    return;
  }
  try {
    const r = await fetch("/api/update/check", {
      credentials: "same-origin",
      headers: { "x-herdr-world-update": "1" },
    });
    if (!r.ok) {
      if (showErrors) {
        const body = await r.json().catch(() => null);
        set({
          notice: {
            kind: "error",
            message: "Update check failed",
            detail: body?.error ?? r.statusText,
          },
        });
      }
      return;
    }
    const info = (await r.json()) as UpdateInfo;
    if (!showErrors && !state.automaticUpdateChecksEnabled) return;
    if (info.update_available && info.latest_version) {
      const firstNotification = updateNotifications.claim(info.latest_version);
      const notificationStillOpen =
        state.updateInfo?.latest_version === info.latest_version &&
        state.dismissedUpdateVersion !== info.latest_version;
      set({
        updateInfo: info,
        dismissedUpdateVersion:
          firstNotification || notificationStillOpen
            ? null
            : info.latest_version,
      });
    } else if (!info.update_available) {
      set({
        updateInfo: null,
        notice: showErrors
          ? {
              kind: "success",
              message: "Herdr World is up to date",
              detail: info.latest_version
                ? `Current version: ${info.current_version}`
                : undefined,
            }
          : state.notice,
      });
    }
  } catch (e) {
    if (showErrors) {
      set({
        notice: {
          kind: "error",
          message: "Update check failed",
          detail: (e as Error).message,
        },
      });
    }
  }
}

function startUpdatePolling(): Promise<void> {
  if (updateTimer || !state.automaticUpdateChecksEnabled) {
    return Promise.resolve();
  }
  const initialCheck = checkForUpdate(false);
  updateTimer = setInterval(
    () => {
      void checkForUpdate(false);
    },
    30 * 60 * 1000,
  );
  return initialCheck;
}

function applyAutomaticUpdateChecksEnabled(enabled: boolean) {
  if (!enabled && updateTimer) {
    clearInterval(updateTimer);
    updateTimer = null;
  }
  set({
    automaticUpdateChecksEnabled: enabled,
  });
  if (enabled && !state.connectionPaused) void startUpdatePolling();
}

function handlePreferenceStorageChange(key: string | null) {
  if (
    key === TASK_NOTIFICATIONS_KEY ||
    key === TASK_NOTIFICATION_PREFERENCES_KEY ||
    key === null
  ) {
    set({
      taskNotificationsEnabled: storedTaskNotificationsEnabled(),
      taskNotificationPreferences: storedTaskNotificationPreferences(),
    });
    void store.restoreTaskNotifications();
  }
  if (key === AUTOMATIC_UPDATE_CHECKS_KEY || key === null) {
    const enabled = storedAutomaticUpdateChecksEnabled();
    if (enabled !== state.automaticUpdateChecksEnabled)
      applyAutomaticUpdateChecksEnabled(enabled);
  }
}

function stopPolling() {
  for (const timer of refreshTimers.values()) clearTimeout(timer);
  refreshTimers.clear();
  if (metadataTimer) {
    clearInterval(metadataTimer);
    metadataTimer = null;
  }
  if (updateTimer) {
    clearInterval(updateTimer);
    updateTimer = null;
  }
  queuedConnectionKeys.clear();
}

function startPolling() {
  startMetadataPolling();
  startUpdatePolling();
}
export {
  AUTOMATIC_UPDATE_CHECKS_KEY,
  storedAutomaticUpdateChecksEnabled,
  storedPendingRestartVersion,
  consumePendingHerdrUpgrade,
  storePendingRestartVersion,
  redirectToLogin,
  reloadWhenUpdatedServerIsReady,
  updateTimer,
  checkForUpdate,
  startUpdatePolling,
  applyAutomaticUpdateChecksEnabled,
  handlePreferenceStorageChange,
  stopPolling,
  startPolling,
};
