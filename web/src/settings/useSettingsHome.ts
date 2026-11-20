/**
 * The Menu's side of Settings (#1035): where Settings is open, which of its
 * dialogs is open, and the host every registry entry changes settings
 * through. The host is published so the command box changes the same
 * settings the Settings screen does.
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
import {
  type OpenIntegrationsDetail,
  WORLD_INTEGRATIONS_EVENT,
} from "../integrations";
import { detectShortcutPlatform } from "../shortcutBindings";
import type { ConfigurationProps } from "./configurationProps";
import { publishSettingsHost, SETTINGS_OPEN_EVENT } from "./host";
import { takeSettingsLink } from "./links";
import type { SettingsHost, SettingsPanel } from "./registry";
import { SETTINGS_DIALOGS, type SettingsDialog } from "./SettingsDialogs";

type Options = {
  configuration: ConfigurationProps;
  zen: SettingsHost["zen"];
  mobile: boolean;
  /** Pass the props themselves (stable), not new arrows each render. */
  panels: Record<
    Exclude<SettingsPanel, SettingsDialog>,
    (() => void) | undefined
  >;
  /** Settings is opening from outside the Menu: close the Menu. */
  onOpen: () => void;
  /** Focus returns here when Settings closes. */
  triggerRef: RefObject<HTMLButtonElement | null>;
};

export type SettingsAt = {
  /** An entry, page or category id; null opens the list at All. */
  target: string | null;
  /** For a page: the row it shows first. */
  focus?: string;
};

function isDialog(panel: SettingsPanel): panel is SettingsDialog {
  return panel in SETTINGS_DIALOGS;
}

export function useSettingsHome({
  configuration,
  zen,
  mobile,
  panels,
  onOpen,
  triggerRef,
}: Options) {
  // Settings open, at an entry or category when a link or Cmd+K named one.
  const [settingsAt, setSettingsAt] = useState<SettingsAt | null>(() => {
    const link = takeSettingsLink();
    return link ? { target: link } : null;
  });
  const [dialog, setDialog] = useState<SettingsDialog | null>(null);
  const settingsOpen = useRef(false);
  settingsOpen.current = settingsAt !== null;
  // A dialog opened from Settings returns to Settings at its row.
  const dialogFromSettings = useRef(false);
  const closeSettings = useCallback(() => setSettingsAt(null), []);
  // Once Settings has gone, focus returns to Menu, unless a row moved it to
  // the dialog or view control it opened (their effects run first).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (settingsAt) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected)
      triggerRef.current?.focus();
  }, [settingsAt, triggerRef]);
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  const closeDialog = useCallback(() => {
    const current = dialogRef.current;
    setDialog(null);
    if (current && dialogFromSettings.current)
      setSettingsAt({ target: SETTINGS_DIALOGS[current] });
    else window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, [triggerRef]);
  const [signedIn, setSignedIn] = useState(false);
  const refreshSignedIn = useCallback(() => {
    fetch("/api/health", { credentials: "same-origin", cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)
      .then((info) => setSignedIn(!!info?.auth_required));
  }, []);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  useEffect(() => {
    refreshSignedIn();
    const onOpenSettings = (event: Event) => {
      onOpenRef.current();
      setSettingsAt({
        target: (event as CustomEvent<string | undefined>).detail ?? null,
      });
    };
    // A World element without what it needs opens Integrations at its row.
    const onOpenIntegrations = (event: Event) => {
      onOpenRef.current();
      setSettingsAt({
        target: "integrations.all",
        focus: (event as CustomEvent<OpenIntegrationsDetail>).detail?.focus,
      });
    };
    window.addEventListener(SETTINGS_OPEN_EVENT, onOpenSettings);
    window.addEventListener(WORLD_INTEGRATIONS_EVENT, onOpenIntegrations);
    return () => {
      window.removeEventListener(SETTINGS_OPEN_EVENT, onOpenSettings);
      window.removeEventListener(WORLD_INTEGRATIONS_EVENT, onOpenIntegrations);
    };
  }, [refreshSignedIn]);

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
  const { shortcuts, sounds } = panels;
  const profiles = panels["agent-profiles"];
  const host = useMemo<SettingsHost>(
    () => ({
      appearance: {
        theme,
        setTheme: onThemeChange,
        accentColor,
        setAccentColor: (accent) => onAccentColorChange(accent as AccentColor),
        blackBackground,
        setBlackBackground: onBlackBackgroundChange,
        uiScale,
        setUiScale: onUiScaleChange,
        terminalFontScale,
        setTerminalFontScale: onTerminalFontScaleChange,
      },
      zen: { on: zenOn, available: zenAvailable, set: setZen },
      openPanel: (panel) => {
        if (isDialog(panel)) {
          dialogFromSettings.current = settingsOpen.current;
          setDialog(panel);
          return;
        }
        ({ shortcuts, "agent-profiles": profiles, sounds })[panel]?.();
      },
      mobile,
      mac: detectShortcutPlatform() === "mac",
      signedIn,
    }),
    [
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
      shortcuts,
      profiles,
      sounds,
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
    settingsAt,
    setSettingsAt,
    closeSettings,
    dialog,
    closeDialog,
    host,
    signedIn,
    refreshSignedIn,
  };
}
