/**
 * The dialogs a Settings row opens (#1035): terminal look, layout, the
 * shortcut editor, the phone's key bar and automatic branch updates. Each
 * opens over the page, and closing it returns to Settings at its row.
 */

import { Suspense } from "react";
import { ConfigurationLoadingDialog } from "../components/ConfigurationLoadingDialog";
import { lazyWithReload } from "../lazyWithReload";
import type { ConfigurationProps } from "./configurationProps";

const ShortcutLookupDialog = lazyWithReload("keyboard-shortcuts", () =>
  import("../components/ShortcutLookupDialog").then((module) => ({
    default: module.ShortcutLookupDialog,
  })),
);
const TerminalThemeDialog = lazyWithReload("terminal-theme", () =>
  import("../components/TerminalThemeDialog").then((module) => ({
    default: module.TerminalThemeDialog,
  })),
);
const MobileLayoutDialog = lazyWithReload("mobile-layout", () =>
  import("../components/MobileLayoutDialog").then((module) => ({
    default: module.MobileLayoutDialog,
  })),
);
const MobileTerminalShortcutsDialog = lazyWithReload("mobile-shortcuts", () =>
  import("../components/MobileTerminalShortcutsDialog").then((module) => ({
    default: module.MobileTerminalShortcutsDialog,
  })),
);
const AutoSyncRepositoriesDialog = lazyWithReload("auto-sync", () =>
  import("../components/AutoSyncRepositoriesDialog").then((module) => ({
    default: module.AutoSyncRepositoriesDialog,
  })),
);

/** The dialogs this file opens, by the panel name entries ask for. */
export type SettingsDialog =
  | "terminal-look"
  | "layout"
  | "shortcut-editor"
  | "phone-keys"
  | "branch-sync";

export const SETTINGS_DIALOGS: Record<SettingsDialog, string> = {
  // The Settings entry each returns to.
  "terminal-look": "appearance.terminal-look",
  layout: "appearance.layout",
  "shortcut-editor": "keyboard.shortcuts",
  "phone-keys": "keyboard.phone-keys",
  "branch-sync": "integrations.branch-sync",
};

export function SettingsDialogs({
  dialog,
  configuration: props,
  onClose,
}: {
  dialog: SettingsDialog | null;
  configuration: ConfigurationProps;
  onClose: () => void;
}) {
  if (!dialog) return null;
  return (
    <Suspense
      fallback={
        <ConfigurationLoadingDialog
          onClose={onClose}
          buttonLabel="Back to Settings"
        />
      }
    >
      {dialog === "shortcut-editor" ? (
        <ShortcutLookupDialog open onClose={onClose} />
      ) : null}
      {dialog === "terminal-look" ? (
        <TerminalThemeDialog
          open
          selection={props.terminalThemeSelection}
          customThemes={props.customTerminalThemes}
          fontName={props.terminalFontName}
          fontScale={props.terminalFontScale}
          onSelectionChange={props.onTerminalThemeSelectionChange}
          onCustomThemesChange={props.onCustomTerminalThemesChange}
          onFontNameChange={props.onTerminalFontNameChange}
          onFontScaleChange={props.onTerminalFontScaleChange}
          onClose={onClose}
        />
      ) : null}
      {dialog === "layout" ? (
        <MobileLayoutDialog open onClose={onClose} />
      ) : null}
      {dialog === "phone-keys" ? (
        <MobileTerminalShortcutsDialog
          open
          rows={props.mobileTerminalShortcuts}
          sideShortcuts={props.mobileTerminalSideShortcuts}
          onChange={props.onMobileTerminalShortcutsChange}
          onSideChange={props.onMobileTerminalSideShortcutsChange}
          onClose={onClose}
        />
      ) : null}
      {dialog === "branch-sync" ? (
        <AutoSyncRepositoriesDialog open onClose={onClose} />
      ) : null}
    </Suspense>
  );
}
