import {
  hostColorKey,
  workspaceColorKey,
  defaultRoomColorFor,
  resolveTerminalColor,
  resolveTerminalColorByKeys,
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

/**
 * The palette, in picker order, shared by the CSS views and Town's canvas.
 * Identity is quiet and attention is loud (#890): every tone has the same
 * OKLCH lightness (0.59) and a low chroma (0.065), with hues spread round the
 * wheel, so the set reads as one family, no tone shouts louder than another,
 * and each keeps 3:1 contrast on the dark, light and white surfaces.
 * Saturated colour is reserved for status (AgentMark.css), whose colours are
 * at least 1.75 times as chromatic as any of these. The stored names stay, so
 * choices saved by earlier builds keep their hue.
 */
export const TERMINAL_COLOR_HEX: Readonly<Record<TerminalColor, string>> = {
  red: "#a16e6a",
  orange: "#9a7555",
  yellow: "#877e50",
  green: "#658865",
  teal: "#4b8a87",
  blue: "#5f80a3",
  purple: "#83759f",
  pink: "#9a6e86",
};
export const TERMINAL_COLORS = Object.keys(
  TERMINAL_COLOR_HEX,
) as readonly TerminalColor[];

/** The palette as the shared colour picker (ColorSwatch.tsx) takes it. */
export const TERMINAL_COLOR_PALETTE = TERMINAL_COLORS.map((id) => ({
  id,
  hex: TERMINAL_COLOR_HEX[id],
}));

export type TerminalColorTarget = TerminalTab;
export type TerminalColors = Readonly<Record<string, TerminalColor>>;

/** The key a colour is saved under: the tab's Board card key. */
export const terminalColorKey = (target: TerminalColorTarget) =>
  tabCardKey(target.connectionId, target.tabId, target.workspaceIds);

export const defaultRoomColor = defaultRoomColorFor;

/**
 * The colour a tab shows, and whether the tab has its own saved colour (only
 * then is there something to reset; its room's colour is not).
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

/** The same rule from a tab's card key and its room's key (Board). */
export const resolveTerminalByKeys = (
  colors: TerminalColors,
  key: string,
  workspaceKey: string,
): { color: TerminalColor; own: boolean } =>
  resolveTerminalColorByKeys(colors, key, workspaceKey) as {
    color: TerminalColor;
    own: boolean;
  };

export { hostColorKey, workspaceColorKey };

/**
 * A workspace's or host's chosen colour, or null when it has none (it then
 * shows its own default: Town's carpet or roof, no tint on Board).
 */
export const placeColor = (
  colors: TerminalColors,
  key: string,
): TerminalColor | null => {
  const color = colors[key];
  return color && TERMINAL_COLORS.includes(color) ? color : null;
};
