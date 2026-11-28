/**
 * A testing-only switch for the Town landmarks' art (#1117): open World with
 * `?townArt=storybook`, `?townArt=harbour` or `?townArt=paper` and the post
 * office, town center, library, apartments, warehouse, piers and lighthouse
 * are painted in that art direction (docs/design/town-art.md) instead of
 * today's art, until the page reloads. The page drops the parameter at once;
 * any other value keeps today's art. Only the paint changes: layout, signs,
 * behaviour and what each building means stay the same.
 *
 * Nothing is stored: the choice is the page's, read once before the first
 * landmark is painted, because every landmark is painted once and shared.
 */

/** @internal The directions, for tests. */
export const TOWN_ART_DIRECTIONS = ["storybook", "harbour", "paper"] as const;
export type TownArtDirection = (typeof TOWN_ART_DIRECTIONS)[number];

const PARAM = "townArt";
let direction: TownArtDirection | null | undefined;

/** The switch, read once per page load; the parameter is removed. */
export function townArtDirection(): TownArtDirection | null {
  if (direction !== undefined) return direction;
  direction = null;
  if (typeof location === "undefined") return direction;
  const url = new URL(location.href);
  const value = url.searchParams.get(PARAM);
  if (value === null) return direction;
  direction = (TOWN_ART_DIRECTIONS as readonly string[]).includes(value)
    ? (value as TownArtDirection)
    : null;
  url.searchParams.delete(PARAM);
  history.replaceState(history.state, "", url);
  return direction;
}

/**
 * @internal For tests: choose a direction, or undefined to read the URL
 * again.
 */
export function setTownArtDirection(
  value: TownArtDirection | null | undefined,
) {
  direction = value;
}
