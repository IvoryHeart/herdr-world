import { useCloseGlobalMenuForDialog } from "./useCloseGlobalMenuForDialog";
import { lazyWithReload } from "../lazyWithReload";
import { Suspense, useEffect, useRef, useState } from "react";
import { Menu as MenuIcon } from "lucide-react";
import { APP_VERSION } from "../version";
import { isStaleBuild, useBuildFreshness } from "../buildFreshness";
import { openSounds } from "../chimes/chimeHost";
import { logoutBrowserSession } from "../api";
import { useLayoutPreferences } from "../layoutPreferences";
import { useShortcutPreferences } from "../shortcutPreferences";
import {
  OperationalContext,
  shallowEqual,
  store,
  useStoreSelector,
} from "../store";
import type { ConfigurationProps } from "../settings/configurationProps";
import { ConfigurationLoadingDialog } from "./ConfigurationLoadingDialog";
import { MobileSheetHandle } from "./MobileSheetHandle";
import "./ConfigMenu.css";
import { useLayer } from "../layerStack";
import { WORLD_OPEN_UPDATE_MENU_EVENT } from "../world/townMasterGreeting";
import { openCommandBox } from "../commandBoxKey";
import { ShortMenu } from "../settings/ShortMenu";
import { openFocus } from "../world/focus";
import { SettingsDialogs } from "../settings/SettingsDialogs";
import { useSettingsHome } from "../settings/useSettingsHome";

// Settings (#1035) loads when it first opens.
const SettingsHome = lazyWithReload("settings-home", () =>
  import("../settings/SettingsHome").then((module) => ({
    default: module.SettingsHome,
  })),
);
export const CONFIG_MENU_ID = "herdr-world-config-menu";

export function reloadApplicationPage(
  target: Pick<Location, "reload"> = window.location,
) {
  target.reload();
}

type ConfigMenuProps = ConfigurationProps & {
  zenMode: boolean;
  /** False where Zen would change nothing, such as a phone's terminal. */
  zenAvailable?: boolean;
  onZenModeChange: (zenMode: boolean) => void;
  onOpenAgentProfiles?: () => void;
  onShowShortcuts: () => void;
};

/**
 * The Menu: the few things people do every day, and Settings for the rest.
 */
export function ConfigMenu({
  zenMode,
  zenAvailable = true,
  onZenModeChange,
  onOpenAgentProfiles,
  onShowShortcuts,
  ...configuration
}: ConfigMenuProps) {
  const build = useBuildFreshness();
  const s = useStoreSelector(
    (state) => ({
      bridgeStatus: state.bridgeStatus,
      connectionPaused: state.connectionPaused,
      status: state.status,
      updateInfo: state.updateInfo,
      updateInstalling: state.updateInstalling,
    }),
    shallowEqual,
  );
  const layout = useLayoutPreferences();
  useShortcutPreferences();
  const updateAvailable = !!s.updateInfo?.update_available;
  const canInstallUpdate = updateAvailable && s.updateInfo?.can_auto_update;
  const updateVersion = s.updateInfo?.latest_version;
  const clientCount =
    !s.connectionPaused && s.status === "connected"
      ? s.bridgeStatus?.clients
      : null;
  const [open, setOpen] = useState(false);
  useCloseGlobalMenuForDialog(open, setOpen);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeMenu = () => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const {
    settingsAt,
    setSettingsAt,
    closeSettings,
    dialog,
    closeDialog,
    host,
    signedIn,
    refreshSignedIn,
  } = useSettingsHome({
    configuration,
    zen: { on: zenMode, available: zenAvailable, set: onZenModeChange },
    mobile: layout.mobile,
    panels: {
      shortcuts: onShowShortcuts,
      "agent-profiles": onOpenAgentProfiles,
      sounds: openSounds,
    },
    onOpen: () => setOpen(false),
    triggerRef,
  });

  // Sign-in can change while World runs: ask again each time the Menu opens.
  useEffect(() => {
    if (open) refreshSignedIn();
  }, [open, refreshSignedIn]);
  // A layer on the shared stack: Escape, a press outside (the terminal
  // included) and Back close it, and focus returns to what had it.
  useLayer(open, () => setOpen(false), { element: () => ref.current });
  // The Town Master's update line opens the menu at its update control.
  useEffect(() => {
    const onOpenUpdate = () => {
      setOpen(true);
      window.requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>(".config-update-item")
          ?.scrollIntoView({ block: "nearest" }),
      );
    };
    window.addEventListener(WORLD_OPEN_UPDATE_MENU_EVENT, onOpenUpdate);
    return () =>
      window.removeEventListener(WORLD_OPEN_UPDATE_MENU_EVENT, onOpenUpdate);
  }, []);

  return (
    <>
      <div className="config-menu" ref={ref}>
        <button
          ref={triggerRef}
          className={`topbar-button menu-button ${open ? "is-active" : ""}`}
          onClick={() => {
            setLogoutError("");
            setOpen((value) => !value);
          }}
          aria-label={updateAvailable ? "Menu, update available" : "Menu"}
          aria-controls={open ? CONFIG_MENU_ID : undefined}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <MenuIcon className="menu-button-icon" size={18} aria-hidden="true" />
          <span className="menu-button-label">Menu</span>
          {updateAvailable ? (
            <span className="menu-update-dot" aria-hidden="true" />
          ) : null}
        </button>
        {open ? (
          <div
            id={CONFIG_MENU_ID}
            className="config-dropdown mobile-sheet"
            role="dialog"
            aria-label="Application menu"
          >
            <MobileSheetHandle label="Close menu" onClose={closeMenu} />
            <div className="config-dropdown-content">
              <div className="config-summary">
                <div>
                  <strong>Herdr World</strong>
                  <span>Version {APP_VERSION}</span>
                  {build.loaded ? (
                    <span className="config-build" title="Loaded build">
                      Build {build.loaded}
                      {isStaleBuild(build)
                        ? ` · server serves ${build.served}`
                        : ""}
                    </span>
                  ) : null}
                </div>
                <span
                  className={`config-connection-summary status-${s.connectionPaused ? "paused" : s.status}`}
                >
                  <span className="status-dot" />
                  {s.connectionPaused ? "Paused" : s.status}
                  {typeof clientCount === "number"
                    ? ` · ${clientCount} client${clientCount === 1 ? "" : "s"}`
                    : ""}
                </span>
              </div>
              <ShortMenu
                zenMode={zenMode}
                zenAvailable={zenAvailable}
                mobile={layout.mobile}
                updateLabel={
                  updateAvailable
                    ? s.updateInstalling
                      ? "Updating..."
                      : `Upgrade to ${updateVersion}`
                    : null
                }
                updateDisabled={!!s.updateInstalling || !canInstallUpdate}
                updateNote={
                  updateAvailable && !canInstallUpdate
                    ? (s.updateInfo?.reason ??
                      "Automatic installation is unavailable. Use this installation's update channel.")
                    : null
                }
                signedIn={signedIn}
                loggingOut={loggingOut}
                logoutError={logoutError}
                onSettings={(target) => {
                  setOpen(false);
                  setSettingsAt({ target });
                }}
                onFind={() => {
                  setOpen(false);
                  openCommandBox();
                }}
                onFocus={() => {
                  setOpen(false);
                  openFocus();
                }}
                onZen={() => {
                  onZenModeChange(!zenMode);
                  setOpen(false);
                }}
                onUpdate={() => {
                  setOpen(false);
                  void store.updateOrCheck();
                }}
                onLogOut={async () => {
                  setLoggingOut(true);
                  setLogoutError("");
                  try {
                    await logoutBrowserSession();
                  } catch {
                    setLogoutError(
                      "Could not log out. Check your connection and try again.",
                    );
                    setLoggingOut(false);
                  }
                }}
              />
            </div>
          </div>
        ) : null}
      </div>
      {settingsAt && host ? (
        // Settings names the active connection, so it uses that connection's
        // current lease, not the selection's host of a World view.
        <OperationalContext.Provider value={null}>
          <Suspense
            fallback={<ConfigurationLoadingDialog onClose={closeSettings} />}
          >
            <SettingsHome
              host={host}
              initial={settingsAt.target}
              focus={settingsAt.focus}
              onClose={closeSettings}
            />
          </Suspense>
        </OperationalContext.Provider>
      ) : null}
      <OperationalContext.Provider value={null}>
        <SettingsDialogs
          dialog={dialog}
          configuration={configuration}
          onClose={closeDialog}
        />
      </OperationalContext.Provider>
    </>
  );
}
