import type { CardColor } from "./board/boardDocument";
import { boardKey, boardTabKey } from "./board/boardModel";

/**
 * A terminal's colour: a property of its Herdr tab, shown as the tab in
 * Spaces, the desk in Town and the card in Board. Herdr has no tab colour, so
 * World keeps the user's choice in Board's saved layout on the service, keyed
 * like a Board card (connection and Herdr tab ID), and every device sees the
 * same colour. A tab without a choice takes its workspace's, then a default
 * derived from its key, so it is stable across reloads and devices. A future
 * Herdr tab colour would replace only `customTerminalColor`. The store hooks
 * are in useTerminalColors.ts.
 */

export type TerminalColor = CardColor;

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

export type TerminalColorTarget = {
  connectionId: string;
  workspaceId: string;
  tabId: string;
  /** The host's workspace IDs, which qualify a colliding tab key. */
  workspaceIds: ReadonlySet<string>;
};

export type TerminalColors = Readonly<Record<string, TerminalColor>>;

/** The key a colour is saved under: the tab's Board card key. */
export const terminalColorKey = (target: TerminalColorTarget) =>
  boardTabKey(target.connectionId, target.tabId, target.workspaceIds);

/** FNV-1a, so the default never changes between builds or devices. */
function hash(value: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const defaultTerminalColor = (key: string): TerminalColor =>
  TERMINAL_COLORS[hash(key) % TERMINAL_COLORS.length]!;

/** The colour the user chose for the tab or, failing that, its workspace. */
export function customTerminalColor(
  colors: TerminalColors,
  target: TerminalColorTarget,
): TerminalColor | null {
  return (
    colors[terminalColorKey(target)] ??
    colors[boardKey(target.connectionId, target.workspaceId)] ??
    null
  );
}

export function terminalColor(
  colors: TerminalColors,
  target: TerminalColorTarget,
): TerminalColor {
  return (
    customTerminalColor(colors, target) ??
    defaultTerminalColor(terminalColorKey(target))
  );
}
