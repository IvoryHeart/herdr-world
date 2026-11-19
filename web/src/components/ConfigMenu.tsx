import { useCloseGlobalMenuForDialog } from "./useCloseGlobalMenuForDialog";
import { lazyWithReload } from "../lazyWithReload";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Menu as MenuIcon,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Focus,
  Activity,
  GitPullRequest,
  Keyboard,
  LogOut,
  Palette,
  Plug,
  RefreshCw,
  SlidersHorizontal,
  Server,
  Settings,
  Wifi,
  MessageSquare,
  Wind,
  Bug,
  Shirt,
  Volume2,
  Hand,
  Inbox,
  Search,
  HelpCircle,
} from "lucide-react";
import { APP_VERSION } from "../version";
import { isStaleBuild, useBuildFreshness } from "../buildFreshness";
import { worldLocalStorage } from "../browserStorage";
import { openSounds } from "../chimes/chimeHost";
import { logoutBrowserSession } from "../api";
import { connectionHttpPath } from "../connectionHttp";
import { useLayoutPreferences } from "../layoutPreferences";
import { shortcutLabel, useShortcutPreferences } from "../shortcutPreferences";
import {
  herdrUpgradeMenuEntry,
  herdrUpgradeOffered,
  OperationalContext,
  shallowEqual,
  store,
  useStoreSelector,
} from "../store";
import { useConnectionClient } from "../useConnectionClient";
import type {
  ConfigurationProps,
  ConfigurationTab,
} from "./ConfigurationDialog";
import {
  readOfficePreferences,
  WORLD_OFFICE_PREFERENCES_CHANGED_EVENT,
  writeOfficePreferences,
  type OfficePreferences,
} from "../world/officePreferences";
import { ConfigurationLoadingDialog } from "./ConfigurationLoadingDialog";
import { HerdrSetupCard } from "./HerdrSetupCard";
import { MobileSheetHandle } from "./MobileSheetHandle";
import "./ConfigMenu.css";
import { useLayer } from "../layerStack";
import { DEVTOOLS } from "../world/devtools/flag";
import { WORLD_OPEN_UPDATE_MENU_EVENT } from "../world/townMasterGreeting";
import { requestTrace, traceRemembered } from "../world/devtools/trace";
import { openCommandBox } from "../commandBoxKey";
import { detectShortcutPlatform } from "../shortcutBindings";
import type { AccentColor } from "../appearance";
import { settingsPrototypeOn, takeSettingsLink } from "../settings/flag";
import { publishSettingsHost, SETTINGS_OPEN_EVENT } from "../settings/host";
import type { SettingsHost } from "../settings/registry";

const ConfigurationDialog = lazyWithReload("configuration", () =>
  import("./ConfigurationDialog").then((module) => ({
    default: module.ConfigurationDialog,
  })),
);
// The Settings prototype (#1035), loaded only when the flag opens it.
const SettingsHome = lazyWithReload("settings-home", () =>
  import("../settings/SettingsHome").then((module) => ({
    default: module.SettingsHome,
  })),
);
const RELEASES_URL = "https://github.com/IvoryHeart/herdr-world/releases";
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
  onOpenOfficeMetrics?: () => void;
  onOpenAgentProfiles?: () => void;
  onOpenSources?: () => void;
  onShowShortcuts: () => void;
};

export function ConfigMenu({
  zenMode,
  zenAvailable = true,
  onZenModeChange,
  onOpenOfficeMetrics,
  onOpenAgentProfiles,
  onOpenSources,
  onShowShortcuts,
  ...configuration
}: ConfigMenuProps) {
  const build = useBuildFreshness();
  const s = useStoreSelector(
    (state) => ({
      bridgeStatus: state.bridgeStatus,
      activeConnectionId: state.activeConnectionId,
      defaultConnectionId: state.defaultConnectionId,
      connectionPaused: state.connectionPaused,
      status: state.status,
      updateInfo: state.updateInfo,
      updateInstalling: state.updateInstalling,
      herdrUpgrading: state.herdrUpgrading,
    }),
    shallowEqual,
  );
  const connectionClient = useConnectionClient();
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
  // Town's event trace (development builds only; see world/devtools).
  const [townTrace, setTownTrace] = useState(() =>
    DEVTOOLS ? traceRemembered("town") : false,
  );
  const [expanded, setExpanded] = useState(false);
  const [configurationTab, setConfigurationTab] =
    useState<ConfigurationTab | null>(null);
  const [connectionDetailsOpen, setConnectionDetailsOpen] = useState(false);
  const [officePreferences, setOfficePreferences] = useState(() =>
    readOfficePreferences(worldLocalStorage),
  );
  const [health, setHealth] = useState<{
    socket?: string;
    auth_required?: boolean;
  } | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [herdrInfo, setHerdrInfo] = useState<{
    version: string;
    protocol: number;
  } | null>(null);
  const [herdrUnavailable, setHerdrUnavailable] = useState(false);
  // Offered only on the default connection: the upgrade concerns this
  // machine's Herdr.
  const [herdrUpgrade, setHerdrUpgrade] = useState<{
    label: string;
    description: string;
  } | null>(null);
  const onDefaultConnection =
    !s.connectionPaused && s.activeConnectionId === s.defaultConnectionId;
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeMenu = () => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const closeConfiguration = useCallback(() => {
    setConfigurationTab(null);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  // The Settings prototype (#1035): `?settings=next` for this tab.
  const [prototype] = useState(settingsPrototypeOn);
  // Settings open, at an entry or category when a link or Cmd+K named one.
  const [settingsAt, setSettingsAt] = useState<{
    target: string | null;
  } | null>(() => {
    if (!prototype) return null;
    const link = takeSettingsLink();
    return link ? { target: link } : null;
  });
  const closeSettings = useCallback(() => {
    setSettingsAt(null);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  const [authRequired, setAuthRequired] = useState(false);
  useEffect(() => {
    if (!prototype) return;
    let cancelled = false;
    fetch("/api/health", { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((info) => {
        if (!cancelled) setAuthRequired(!!info?.auth_required);
      });
    const onOpenSettings = (event: Event) => {
      setOpen(false);
      setSettingsAt({
        target: (event as CustomEvent<string | undefined>).detail ?? null,
      });
    };
    window.addEventListener(SETTINGS_OPEN_EVENT, onOpenSettings);
    return () => {
      cancelled = true;
      window.removeEventListener(SETTINGS_OPEN_EVENT, onOpenSettings);
    };
  }, [prototype]);
  const {
    theme,
    onThemeChange,
    accentColor,
    onAccentColorChange,
    blackBackground,
    onBlackBackgroundChange,
    uiScale,
    onUiScaleChange,
    terminalFontScale,
    onTerminalFontScaleChange,
  } = configuration;
  const settingsHost = useMemo<SettingsHost | null>(
    () =>
      prototype
        ? {
            appearance: {
              theme,
              setTheme: onThemeChange,
              accentColor,
              setAccentColor: (accent) =>
                onAccentColorChange(accent as AccentColor),
              blackBackground,
              setBlackBackground: onBlackBackgroundChange,
              uiScale,
              setUiScale: onUiScaleChange,
              terminalFontScale,
              setTerminalFontScale: onTerminalFontScaleChange,
            },
            zen: { on: zenMode, available: zenAvailable, set: onZenModeChange },
            openConfiguration: (tab) =>
              setConfigurationTab(tab as ConfigurationTab),
            openPanel: (panel) => {
              if (panel === "shortcuts") onShowShortcuts();
              else if (panel === "agent-profiles") onOpenAgentProfiles?.();
              else if (panel === "sounds") openSounds();
              else if (panel === "sources") onOpenSources?.();
              else onOpenOfficeMetrics?.();
            },
            mobile: layout.mobile,
            mac: detectShortcutPlatform() === "mac",
            signedIn: authRequired,
          }
        : null,
    [
      prototype,
      theme,
      onThemeChange,
      accentColor,
      onAccentColorChange,
      blackBackground,
      onBlackBackgroundChange,
      uiScale,
      onUiScaleChange,
      terminalFontScale,
      onTerminalFontScaleChange,
      zenMode,
      zenAvailable,
      onZenModeChange,
      onShowShortcuts,
      onOpenAgentProfiles,
      onOpenSources,
      onOpenOfficeMetrics,
      layout.mobile,
      authRequired,
    ],
  );
  // The command box reads the same host for settings it changes.
  useEffect(() => {
    publishSettingsHost(settingsHost);
  }, [settingsHost]);
  useEffect(() => () => publishSettingsHost(null), []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setHealth(null);
    setHerdrInfo(null);
    setHerdrUnavailable(false);
    setHerdrUpgrade(null);
    setOfficePreferences(readOfficePreferences(worldLocalStorage));
    if (onDefaultConnection)
      fetch("/api/herdr/status", {
        credentials: "same-origin",
        cache: "no-store",
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((status) => {
          if (cancelled || !herdrUpgradeOffered(status)) return;
          setHerdrUpgrade(herdrUpgradeMenuEntry(status));
        });
    fetch("/api/health", { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((info) => {
        if (!cancelled) setHealth(info);
      });
    if (connectionClient.isCurrent()) {
      const url = new URL(
        connectionHttpPath(
          connectionClient.connectionId,
          "/herdr-info",
          connectionClient.serverRuntimeGeneration,
        ),
        window.location.origin,
      );
      if (url.origin === window.location.origin)
        fetch(url, { credentials: "same-origin", cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
          .then((info) => {
            if (cancelled || !connectionClient.isCurrent()) return;
            if (info) setHerdrInfo(info);
            else setHerdrUnavailable(true);
          });
    }
    return () => {
      cancelled = true;
    };
  }, [connectionClient, onDefaultConnection, open]);
  // A layer on the shared stack: Escape, a press outside (the terminal
  // included) and Back close it, and focus returns to what had it.
  useLayer(open, () => setOpen(false), { element: () => ref.current });
  // The Town Master's update line opens the menu at its update control.
  useEffect(() => {
    const onOpenUpdate = () => {
      setExpanded(true);
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

  const updateOfficePreferences = (patch: Partial<OfficePreferences>) => {
    const next = writeOfficePreferences(worldLocalStorage, {
      ...readOfficePreferences(worldLocalStorage),
      ...patch,
    });
    setOfficePreferences(next);
    window.dispatchEvent(
      new CustomEvent<OfficePreferences>(
        WORLD_OFFICE_PREFERENCES_CHANGED_EVENT,
        { detail: next },
      ),
    );
  };

  return (
    <>
      <div className="config-menu" ref={ref}>
        <button
          ref={triggerRef}
          className={`topbar-button menu-button ${open ? "is-active" : ""}`}
          onClick={() => {
            setExpanded(false);
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
            className={`config-dropdown mobile-sheet${expanded ? " is-expanded" : ""}`}
            role="dialog"
            aria-label="Application menu"
          >
            <MobileSheetHandle
              label={
                expanded ? "Show fewer menu options" : "Show more menu options"
              }
              expanded={expanded}
              onExpand={() => setExpanded(true)}
              onCollapse={() => setExpanded(false)}
              onClose={closeMenu}
              onClick={() => setExpanded((value) => !value)}
            />
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
              {prototype ? (
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
                  signedIn={authRequired}
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
              ) : (
                <>
                  <div className="config-section">
                    <ConfigMenuItem
                      icon={<Settings size={15} />}
                      label="Configuration"
                      description="Appearance, behavior, connections, and agent integrations"
                      className="config-menu-item-row"
                      onClick={() => {
                        setOpen(false);
                        setConfigurationTab("Appearance");
                      }}
                    />
                    {layout.mobile ? null : (
                      <ConfigMenuItem
                        icon={<Keyboard size={15} />}
                        label="Shortcut cheat sheet"
                        description={`Read-only overview \u00b7 ${shortcutLabel("shortcuts.show")}`}
                        className="config-menu-item-row"
                        onClick={() => {
                          setOpen(false);
                          onShowShortcuts();
                        }}
                      />
                    )}
                    {zenAvailable ? (
                      <div className="config-preference-row">
                        <span className="config-item-icon">
                          <Focus size={15} />
                        </span>
                        <div className="config-item-copy">
                          <strong>Zen mode</strong>
                          <span>
                            {zenMode ? "Enabled" : "Disabled"}
                            {layout.mobile
                              ? ""
                              : ` · ${shortcutLabel("zen.toggle")}`}
                          </span>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-label="Zen mode"
                          aria-checked={zenMode}
                          className={
                            "settings-switch" + (zenMode ? " is-on" : "")
                          }
                          onClick={() => {
                            onZenModeChange(!zenMode);
                            setOpen(false);
                          }}
                        >
                          <span />
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="config-section config-section-tiles-3">
                    <div className="config-title">Views</div>
                    <label className="config-preference-row">
                      <span className="config-item-icon">
                        <Focus size={15} />
                      </span>
                      <span className="config-item-copy">
                        <strong>Inspector opening</strong>
                        <span>
                          How a newly opened entity's Inspector appears
                        </span>
                      </span>
                      <select
                        className="config-preference-select"
                        aria-label="Inspector opening"
                        value={officePreferences.inspectorPresentation}
                        onChange={(event) =>
                          updateOfficePreferences({
                            inspectorPresentation: event.target
                              .value as OfficePreferences["inspectorPresentation"],
                          })
                        }
                      >
                        <option value="floating">Floating</option>
                        <option value="docked">Snap right</option>
                      </select>
                    </label>
                    <label className="config-preference-row">
                      <span className="config-item-icon">
                        <MessageSquare size={15} />
                      </span>
                      <span className="config-item-copy">
                        <strong>Agents open</strong>
                        <span>
                          What opening an agent shows: its Chat, or its terminal
                        </span>
                      </span>
                      <select
                        className="config-preference-select"
                        aria-label="Agents open"
                        value={officePreferences.townOpens}
                        onChange={(event) =>
                          updateOfficePreferences({
                            townOpens: event.target
                              .value as OfficePreferences["townOpens"],
                          })
                        }
                      >
                        <option value="chat">Chat</option>
                        <option value="terminal">Terminal</option>
                      </select>
                    </label>
                    <label className="config-preference-row">
                      <span className="config-item-icon">
                        <MessageSquare size={15} />
                      </span>
                      <span className="config-item-copy">
                        <strong>Town master</strong>
                        <span>
                          The agent whose chat Town docks from the start; empty
                          docks none
                        </span>
                      </span>
                      <input
                        className="config-preference-select"
                        aria-label="Town master"
                        defaultValue={officePreferences.townMaster}
                        maxLength={64}
                        spellCheck={false}
                        autoComplete="off"
                        onBlur={(event) =>
                          updateOfficePreferences({
                            townMaster: event.currentTarget.value,
                          })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                    </label>
                    <div className="config-preference-row">
                      <span className="config-item-icon">
                        <Wind size={15} />
                      </span>
                      <div className="config-item-copy">
                        <strong>Town calm motion</strong>
                        <span>
                          Less ambient motion and shorter camera moves
                        </span>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-label="Town calm motion"
                        aria-checked={officePreferences.townCalm}
                        className={
                          "settings-switch" +
                          (officePreferences.townCalm ? " is-on" : "")
                        }
                        onClick={() =>
                          updateOfficePreferences({
                            townCalm: !officePreferences.townCalm,
                          })
                        }
                      >
                        <span />
                      </button>
                    </div>
                    <div className="config-preference-row">
                      <span className="config-item-icon">
                        <Hand size={15} />
                      </span>
                      <div className="config-item-copy">
                        <strong>Town Master greeting</strong>
                        <span>
                          Hello and what changed since you left, on each visit
                          (Show this on start)
                        </span>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-label="Town Master greeting"
                        aria-checked={officePreferences.townGreeting}
                        className={
                          "settings-switch" +
                          (officePreferences.townGreeting ? " is-on" : "")
                        }
                        onClick={() =>
                          updateOfficePreferences({
                            townGreeting: !officePreferences.townGreeting,
                          })
                        }
                      >
                        <span />
                      </button>
                    </div>
                    <div className="config-preference-row">
                      <span className="config-item-icon">
                        <Inbox size={15} />
                      </span>
                      <div className="config-item-copy">
                        <strong>Count on tab and app icon</strong>
                        <span>
                          The browser tab and installed app show how many things
                          need you (this browser)
                        </span>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-label="Count on tab and app icon"
                        aria-checked={officePreferences.tabBadge}
                        className={
                          "settings-switch" +
                          (officePreferences.tabBadge ? " is-on" : "")
                        }
                        onClick={() =>
                          updateOfficePreferences({
                            tabBadge: !officePreferences.tabBadge,
                          })
                        }
                      >
                        <span />
                      </button>
                    </div>
                    {DEVTOOLS ? (
                      <div className="config-preference-row">
                        <span className="config-item-icon">
                          <Bug size={15} />
                        </span>
                        <div className="config-item-copy">
                          <strong>Town event trace</strong>
                          <span>Development builds: record Town's input</span>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-label="Town event trace"
                          aria-checked={townTrace}
                          className={
                            "settings-switch" + (townTrace ? " is-on" : "")
                          }
                          onClick={() => {
                            requestTrace("town", !townTrace);
                            setTownTrace(!townTrace);
                          }}
                        >
                          <span />
                        </button>
                      </div>
                    ) : null}
                    {onOpenAgentProfiles ? (
                      <ConfigMenuItem
                        icon={<Shirt size={15} />}
                        label="Agent profiles"
                        className="config-menu-item-row"
                        description="Name, brain, skills, brief and look for new agents"
                        onClick={() => {
                          setOpen(false);
                          onOpenAgentProfiles();
                        }}
                      />
                    ) : null}
                    {/* Sounds sits with the agents' other settings. */}
                    {onOpenAgentProfiles ? (
                      <ConfigMenuItem
                        icon={<Volume2 size={15} />}
                        label="Sounds"
                        className="config-menu-item-row"
                        description="Chimes for agents that need you, and the Town master"
                        onClick={() => {
                          setOpen(false);
                          openSounds();
                        }}
                      />
                    ) : null}
                    {onOpenSources ? (
                      <ConfigMenuItem
                        icon={<GitPullRequest size={15} />}
                        label="Sources"
                        className="config-menu-item-row"
                        description="GitHub pull requests and Jira tickets beside your agents"
                        onClick={() => {
                          setOpen(false);
                          onOpenSources();
                        }}
                      />
                    ) : null}
                    {onOpenOfficeMetrics ? (
                      <ConfigMenuItem
                        icon={<Activity size={15} />}
                        label="OTEL economy metrics"
                        className="config-menu-item-row"
                        description="Connect Prometheus to show cost on the Town board"
                        onClick={() => {
                          setOpen(false);
                          onOpenOfficeMetrics();
                        }}
                      />
                    ) : null}
                  </div>
                  <div className="config-section">
                    <div className="config-title">Help & updates</div>
                    {[
                      {
                        label: "Tutorial",
                        description:
                          "Learn local work and private remote access",
                        url: "https://herdr.world/tutorial/",
                      },
                      {
                        label: "Features and shortcuts",
                        description: "Browse features and keyboard bindings",
                        url: "https://github.com/IvoryHeart/herdr-world/blob/main/FEATURES.md",
                      },
                      {
                        label: "Troubleshooting",
                        description:
                          "Resolve connection and deployment problems",
                        url: "https://github.com/IvoryHeart/herdr-world/blob/main/docs/DEPLOYMENT.md#troubleshooting",
                      },
                      {
                        label: "Report an issue",
                        description:
                          "Report bugs or request improvements on GitHub",
                        url: "https://github.com/IvoryHeart/herdr-world/issues",
                      },
                    ].map(({ label, description, url }) => (
                      <ConfigMenuItem
                        key={label}
                        icon={<ExternalLink size={15} />}
                        label={label}
                        description={description}
                        onClick={() => {
                          setOpen(false);
                          window.open(url, "_blank", "noopener,noreferrer");
                        }}
                      />
                    ))}
                    <ConfigMenuItem
                      icon={<ExternalLink size={15} />}
                      label="Changelog"
                      description="Recent changes on GitHub"
                      onClick={() => {
                        setOpen(false);
                        window.open(
                          RELEASES_URL,
                          "_blank",
                          "noopener,noreferrer",
                        );
                      }}
                    />
                    <ConfigMenuItem
                      icon={<RefreshCw size={15} />}
                      label="Reload page"
                      description="Refresh the application"
                      onClick={() => {
                        setOpen(false);
                        reloadApplicationPage();
                      }}
                    />
                    <ConfigMenuItem
                      icon={<Download size={15} />}
                      className="config-update-item"
                      label={
                        updateAvailable
                          ? s.updateInstalling
                            ? "Updating..."
                            : `Upgrade to ${updateVersion}`
                          : "Check for updates"
                      }
                      description={
                        canInstallUpdate
                          ? "Install and restart"
                          : updateAvailable
                            ? undefined
                            : "Check the release server"
                      }
                      primary={canInstallUpdate}
                      disabled={
                        s.updateInstalling ||
                        (updateAvailable && !canInstallUpdate)
                      }
                      onClick={() => {
                        setOpen(false);
                        void store.updateOrCheck();
                      }}
                    />
                    {updateAvailable ? (
                      <ConfigMenuItem
                        icon={<RefreshCw size={15} />}
                        label="Check for updates"
                        description="Refresh release availability"
                        disabled={s.updateInstalling}
                        onClick={() => {
                          setOpen(false);
                          void store.checkForUpdate();
                        }}
                      />
                    ) : null}
                    {updateAvailable && !canInstallUpdate ? (
                      <p className="config-update-reason" role="note">
                        {s.updateInfo?.reason ??
                          "Automatic installation is unavailable. Use this installation's update channel."}
                      </p>
                    ) : null}
                  </div>
                  <div className="config-section">
                    <div className="config-title">Runtime</div>
                    <div className="config-runtime-row">
                      <span className="config-item-icon">
                        <Server size={15} />
                      </span>
                      <div className="config-item-copy">
                        <strong>Herdr server</strong>
                        <span>
                          {herdrInfo?.version
                            ? `Version ${herdrInfo.version}`
                            : herdrUnavailable
                              ? "Unavailable"
                              : "Loading server information"}
                        </span>
                      </div>
                      <code>
                        {typeof herdrInfo?.protocol === "number"
                          ? `Protocol ${herdrInfo.protocol}`
                          : "-"}
                      </code>
                    </div>
                    {herdrUpgrade ? (
                      <ConfigMenuItem
                        icon={<Download size={15} />}
                        label={
                          s.herdrUpgrading
                            ? "Updating Herdr..."
                            : herdrUpgrade.label
                        }
                        description={herdrUpgrade.description}
                        primary
                        disabled={s.herdrUpgrading}
                        onClick={() => {
                          setOpen(false);
                          void store.upgradeHerdr();
                        }}
                      />
                    ) : null}
                    {herdrUnavailable ? (
                      <HerdrSetupCard
                        key={connectionClient.connectionId}
                        enabled={
                          !s.connectionPaused &&
                          s.activeConnectionId === s.defaultConnectionId
                        }
                        compact
                      />
                    ) : null}
                    <button
                      type="button"
                      className="config-details-toggle"
                      aria-expanded={connectionDetailsOpen}
                      onClick={() =>
                        setConnectionDetailsOpen((value) => !value)
                      }
                    >
                      <span className="config-item-icon">
                        <Wifi size={15} />
                      </span>
                      <span>Connection details</span>
                      {connectionDetailsOpen ? (
                        <ChevronDown size={15} />
                      ) : (
                        <ChevronRight size={15} />
                      )}
                    </button>
                    {connectionDetailsOpen ? (
                      <div className="config-details">
                        <ConfigRow label="URL" value={location.origin} />
                        <ConfigRow
                          label="Socket"
                          value={health?.socket ?? "-"}
                        />
                      </div>
                    ) : null}
                  </div>
                  {health?.auth_required ? (
                    <div className="config-section">
                      <ConfigMenuItem
                        icon={<LogOut size={15} />}
                        label={loggingOut ? "Logging out..." : "Log out"}
                        description="End this browser session only"
                        className="config-menu-item-row"
                        disabled={loggingOut}
                        onClick={async () => {
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
                      {logoutError ? (
                        <p className="config-logout-error" role="alert">
                          {logoutError}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {layout.mobile ? (
                    <div className="mobile-sheet-more" aria-hidden={!expanded}>
                      <div className="mobile-sheet-more-content">
                        <div className="config-section">
                          <div className="config-title">Quick settings</div>
                          {(
                            [
                              ["Appearance", Palette],
                              ["Behavior", SlidersHorizontal],
                              ["Connection", Server],
                              ["Integrations", Plug],
                            ] as const
                          ).map(([name, Icon]) => (
                            <ConfigMenuItem
                              key={name}
                              icon={<Icon size={15} />}
                              label={name}
                              onClick={() => {
                                setOpen(false);
                                setConfigurationTab(name);
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
      {/* Escape both topbar120 and the transformed phone app context. This
          includes loading and all Configuration detail dialogs. */}
      {configurationTab
        ? createPortal(
            // Configuration names the active connection, so it uses that
            // connection's current lease. A World view's context is its
            // selection's host, or none at all, which left Integrations and
            // Connection settings on a client that was never current.
            <OperationalContext.Provider value={null}>
              <Suspense
                fallback={
                  <ConfigurationLoadingDialog onClose={closeConfiguration} />
                }
              >
                <ConfigurationDialog
                  {...configuration}
                  initialTab={configurationTab}
                  onClose={closeConfiguration}
                />
              </Suspense>
            </OperationalContext.Provider>,
            document.body,
          )
        : null}
      {settingsAt && settingsHost ? (
        <OperationalContext.Provider value={null}>
          <Suspense fallback={null}>
            <SettingsHome
              host={settingsHost}
              initial={settingsAt.target}
              onClose={closeSettings}
            />
          </Suspense>
        </OperationalContext.Provider>
      ) : null}
    </>
  );
}

/**
 * The short Menu of the Settings prototype (#1035): the few things people do
 * every day. Everything else is in Settings and its search.
 */
function ShortMenu({
  zenMode,
  zenAvailable,
  mobile,
  updateLabel,
  updateDisabled,
  updateNote,
  signedIn,
  loggingOut,
  logoutError,
  onSettings,
  onFind,
  onZen,
  onUpdate,
  onLogOut,
}: {
  zenMode: boolean;
  zenAvailable: boolean;
  mobile: boolean;
  updateLabel: string | null;
  updateDisabled: boolean;
  updateNote: string | null;
  signedIn: boolean;
  loggingOut: boolean;
  logoutError: string;
  onSettings: (target: string | null) => void;
  onFind: () => void;
  onZen: () => void;
  onUpdate: () => void;
  onLogOut: () => void;
}) {
  return (
    <div className="config-section config-short-menu">
      <ConfigMenuItem
        icon={<Settings size={15} />}
        label="Settings"
        description="Every setting and command, with search"
        className="config-menu-item-row"
        onClick={() => onSettings(null)}
      />
      <ConfigMenuItem
        icon={<Search size={15} />}
        label="Find or act"
        description={
          mobile
            ? "Search World, settings and commands"
            : `Search World, settings and commands · ${shortcutLabel("command.menu")}`
        }
        className="config-menu-item-row"
        onClick={onFind}
      />
      {zenAvailable ? (
        <div className="config-preference-row">
          <span className="config-item-icon">
            <Focus size={15} />
          </span>
          <div className="config-item-copy">
            <strong>Zen mode</strong>
            <span>
              {zenMode ? "Enabled" : "Disabled"}
              {mobile ? "" : ` · ${shortcutLabel("zen.toggle")}`}
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="Zen mode"
            aria-checked={zenMode}
            className={"settings-switch" + (zenMode ? " is-on" : "")}
            onClick={onZen}
          >
            <span />
          </button>
        </div>
      ) : null}
      {updateLabel ? (
        <ConfigMenuItem
          icon={<Download size={15} />}
          className="config-update-item config-menu-item-row"
          label={updateLabel}
          description={updateDisabled ? undefined : "Install and restart"}
          primary={!updateDisabled}
          disabled={updateDisabled}
          onClick={onUpdate}
        />
      ) : null}
      {updateNote ? (
        <p className="config-update-reason" role="note">
          {updateNote}
        </p>
      ) : null}
      <ConfigMenuItem
        icon={<HelpCircle size={15} />}
        label="Help"
        description="Tutorial, features, troubleshooting and changes"
        className="config-menu-item-row"
        onClick={() => onSettings("help")}
      />
      {signedIn ? (
        <>
          <ConfigMenuItem
            icon={<LogOut size={15} />}
            label={loggingOut ? "Logging out..." : "Log out"}
            description="End this browser session only"
            className="config-menu-item-row"
            disabled={loggingOut}
            onClick={onLogOut}
          />
          {logoutError ? (
            <p className="config-logout-error" role="alert">
              {logoutError}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function ConfigMenuItem({
  icon,
  label,
  description,
  onClick,
  disabled = false,
  primary = false,
  className,
}: {
  icon: ReactNode;
  label: string;
  description?: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`config-menu-item${primary ? " is-primary" : ""}${className ? ` ${className}` : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="config-item-icon">{icon}</span>
      <span className="config-item-copy">
        <strong>{label}</strong>
        {description ? <span>{description}</span> : null}
      </span>
      <ChevronRight size={15} />
    </button>
  );
}
function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="config-row">
      <span>{label}</span>
      <code title={value}>{value}</code>
    </div>
  );
}
