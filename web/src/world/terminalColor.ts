import {
  defaultTerminalColorFor,
  resolveTerminalColor,
  tabCardKey,
  type TerminalColorName,
  type TerminalTab,
} from "../../../shared/terminalColor";

/**
 * A terminal's colour in the browser: the shared rules
 * (shared/terminalColor.ts) plus the palette the views draw with. World keeps
 * a chosen colour in Board's saved layout on the service, so every device sees
 * the same colour. A future Herdr tab colour would replace only the saved
 * colour that `resolveTerminalColor` reads. The store hooks are in
 * useTerminalColors.ts.
 */

export type TerminalColor = TerminalColorName;

/** The palette, in picker order, shared by the CSS views and Town's canvas. */
export const TERMINAL_COLOR_HEX: Readonly<Record<TerminalColor, string>> = {
  red: "#e5534b",
  orange: "#e8853d",
  yellow: "#d9b43b",
  green: "#57ab5a",
  teal: "#39b5a4",
  blue: "#4f8ef7",
  purple: "#9a6ef0",
  pink: "#e26fae",
};
export const TERMINAL_COLORS = Object.keys(
  TERMINAL_COLOR_HEX,
) as readonly TerminalColor[];

export type TerminalColorTarget = TerminalTab;
export type TerminalColors = Readonly<Record<string, TerminalColor>>;

/** The key a colour is saved under: the tab's Board card key. */
export const terminalColorKey = (target: TerminalColorTarget) =>
  tabCardKey(target.connectionId, target.tabId, target.workspaceIds);

export const defaultTerminalColor = defaultTerminalColorFor;

/**
 * The colour a tab shows, and whether the tab has its own saved colour (only
 * then is there something to reset; an inherited workspace colour is not).
 */
export const resolveTerminal = (
  colors: TerminalColors,
  target: TerminalColorTarget,
): { color: TerminalColor; own: boolean } =>
  resolveTerminalColor(colors, target) as {
    color: TerminalColor;
    own: boolean;
  };

export const terminalColor = (
  colors: TerminalColors,
  target: TerminalColorTarget,
): TerminalColor => resolveTerminal(colors, target).color;
