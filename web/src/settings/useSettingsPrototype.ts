/**
 * The Menu's side of the Settings prototype (#1035): whether `?settings=next`
 * is on, where Settings is open, and the host every registry entry changes
 * settings through. The host is published so the command box changes the
 * same settings the Settings screen does.
 */

import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AccentColor } from "../appearance";
import type {
  ConfigurationProps,
  ConfigurationTab,
} from "../components/ConfigurationDialog";
import { detectShortcutPlatform } from "../shortcutBindings";
import { settingsPrototypeOn, takeSettingsLink } from "./flag";
import { publishSettingsHost, SETTINGS_OPEN_EVENT } from "./host";
import type { SettingsHost, SettingsPanel } from "./registry";

type Options = {
  configuration: ConfigurationProps;
  zen: SettingsHost["zen"];
  mobile: boolean;
  openConfiguration: (tab: ConfigurationTab) => void;
  /** Pass the props themselves (stable), not new arrows each render. */
  panels: Record<SettingsPanel, (() => void) | undefined>;
  /** Settings is opening from outside the Menu: close the Menu. */
  onOpen: () => void;
  /** Focus returns here when Settings closes. */
  triggerRef: RefObject<HTMLButtonElement | null>;
};

export function useSettingsPrototype({
  configuration,
  zen,
  mobile,
  openConfiguration,
  panels,
  onOpen,
  triggerRef,
}: Options) {
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
  }, [triggerRef]);
  const [signedIn, setSignedIn] = useState(false);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  useEffect(() => {
    if (!prototype) return;
    let cancelled = false;
    fetch("/api/health", { credentials: "same-origin", cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)
      .then((info) => {
        if (!cancelled) setSignedIn(!!info?.auth_required);
      });
    const onOpenSettings = (event: Event) => {
      onOpenRef.current();
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
  const { on: zenOn, available: zenAvailable, set: setZen } = zen;
  const { shortcuts, sounds, sources, metrics, runtime } = panels;
  const profiles = panels["agent-profiles"];
  const host = useMemo<SettingsHost | null>(
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
            zen: { on: zenOn, available: zenAvailable, set: setZen },
            openConfiguration: (tab) =>
              openConfiguration(tab as ConfigurationTab),
            openPanel: (panel) =>
              ({
                shortcuts,
                "agent-profiles": profiles,
                sounds,
                sources,
                metrics,
                runtime,
              })[panel]?.(),
            mobile,
            mac: detectShortcutPlatform() === "mac",
            signedIn,
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
      zenOn,
      zenAvailable,
      setZen,
      openConfiguration,
      shortcuts,
      profiles,
      sounds,
      sources,
      metrics,
      runtime,
      mobile,
      signedIn,
    ],
  );
  // The command box reads the same host for settings it changes.
  useEffect(() => {
    publishSettingsHost(host);
  }, [host]);
  useEffect(() => () => publishSettingsHost(null), []);

  return {
    prototype,
    settingsAt,
    setSettingsAt,
    closeSettings,
    host,
    signedIn,
  };
}
