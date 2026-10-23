/**
 * A terminal's colour: one per Herdr tab, shown as its tab in Spaces, its
 * table in Town and its card in Board. Herdr has no tab colour, so World keeps
 * a chosen colour in Board's saved layout on the service, under the tab's
 * Board card key. Without one, a tab takes the colour of the tab whose agent
 * spawned it (shared/relations.ts), then its workspace's colour, then a
 * default derived from its key. The browser and the service share these rules
 * so they agree on keys and defaults.
 */

export const TERMINAL_COLOR_NAMES = [
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
] as const;
export type TerminalColorName = (typeof TERMINAL_COLOR_NAMES)[number];

export const cardKey = (connectionId: string, nativeId: string) =>
  `${connectionId}:${nativeId}`;

/**
 * Places have colours too, kept with the terminal colours. A workspace's is
 * saved under its Board card key, and its tabs without a colour of their own
 * show it. A host's colours only its own chrome (Town's building, Board's
 * zone, Spaces' host header); it is not inherited, so tabs keep their varied
 * defaults. Its key cannot be a card key, which always starts with the
 * connection ID and a colon.
 */
export const workspaceColorKey = cardKey;
export const hostColorKey = (connectionId: string) => `@host:${connectionId}`;

/**
 * A tab's card key. Current Herdr IDs never collide (`w1` and `w1:t1`), so a
 * tab keeps the plain key; older Herdr can give a tab the same ID as a
 * workspace, and then the tab's key is qualified so the two stay distinct.
 */
export const tabCardKey = (
  connectionId: string,
  tabId: string,
  workspaceIds: ReadonlySet<string>,
) =>
  workspaceIds.has(tabId)
    ? cardKey(connectionId, `tab:${tabId}`)
    : cardKey(connectionId, tabId);

/**
 * Where a spawned tab's inherited colour sits among the colours: computed by
 * the browser from relations, never saved, and never a tab's own colour.
 */
export const inheritedColorKey = (key: string) => `~${key}`;

/** FNV-1a, so the default never changes between builds or devices. */
function hash(value: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const defaultTerminalColorFor = (key: string): TerminalColorName =>
  TERMINAL_COLOR_NAMES[hash(key) % TERMINAL_COLOR_NAMES.length]!;

export type TerminalTab = {
  connectionId: string;
  workspaceId: string;
  tabId: string;
  /** The host's workspace IDs, which qualify a colliding tab key. */
  workspaceIds: ReadonlySet<string>;
};

/** The colour a tab shows, and whether the tab itself has a saved one. */
export function resolveTerminalColor<C extends string>(
  colors: Readonly<Record<string, C>>,
  tab: TerminalTab,
): { color: C | TerminalColorName; own: boolean } {
  const key = tabCardKey(tab.connectionId, tab.tabId, tab.workspaceIds);
  // A saved colour outside the palette (from an older or newer build) counts
  // as none, so every view shows a colour the picker offers.
  const known = (color: C | undefined) =>
    color !== undefined &&
    (TERMINAL_COLOR_NAMES as readonly string[]).includes(color)
      ? color
      : undefined;
  const own = known(colors[key]);
  if (own) return { color: own, own: true };
  return {
    color:
      known(colors[inheritedColorKey(key)]) ??
      known(colors[cardKey(tab.connectionId, tab.workspaceId)]) ??
      defaultTerminalColorFor(key),
    own: false,
  };
}
