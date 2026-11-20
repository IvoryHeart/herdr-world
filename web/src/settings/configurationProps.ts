import type { Theme } from "../App";
import type { AccentColor } from "../appearance";
import type {
  MobileTerminalShortcutRows,
  MobileTerminalSideShortcuts,
} from "../mobileTerminalShortcuts";
import type {
  CustomTerminalTheme,
  TerminalThemeSelection,
} from "../terminalThemes";

/** The appearance and terminal values App owns, with their setters. */
export type ConfigurationProps = {
  theme: Theme;
  accentColor: AccentColor;
  uiScale: number;
  terminalFontScale: number;
  terminalFontName: string;
  mobileTerminalShortcuts: MobileTerminalShortcutRows;
  mobileTerminalSideShortcuts: MobileTerminalSideShortcuts;
  terminalThemeSelection: TerminalThemeSelection;
  customTerminalThemes: CustomTerminalTheme[];
  onThemeChange: (theme: Theme) => void;
  blackBackground: boolean;
  onBlackBackgroundChange: (blackBackground: boolean) => void;
  onAccentColorChange: (accentColor: AccentColor) => void;
  onUiScaleChange: (scale: number) => void;
  onTerminalFontScaleChange: (scale: number) => void;
  onTerminalFontNameChange: (name: string) => void;
  onMobileTerminalShortcutsChange: (rows: MobileTerminalShortcutRows) => void;
  onMobileTerminalSideShortcutsChange: (
    shortcuts: MobileTerminalSideShortcuts,
  ) => void;
  onTerminalThemeSelectionChange: (selection: TerminalThemeSelection) => void;
  onCustomTerminalThemesChange: (themes: CustomTerminalTheme[]) => void;
};
