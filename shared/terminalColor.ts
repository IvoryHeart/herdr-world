/**
 * A terminal's colour: one per Herdr tab, shown as its tab in Spaces, its
 * table in Town and its card in Board. Herdr has no tab colour, so World keeps
 * a chosen colour in Board's saved layout on the service, under the tab's
 * Board card key. Without one, a tab takes its workspace's colour, then a
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
  const own = colors[key];
  if (own) return { color: own, own: true };
  return {
    color:
      colors[cardKey(tab.connectionId, tab.workspaceId)] ??
      defaultTerminalColorFor(key),
    own: false,
  };
}
