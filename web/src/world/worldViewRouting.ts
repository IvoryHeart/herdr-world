export type WorldView = "desk" | "spaces" | "town" | "board";

export const WORLD_VIEWS: readonly WorldView[] = [
  "town",
  "board",
  "desk",
  "spaces",
];

export const WORLD_VIEW_PATHS: Record<WorldView, string> = {
  desk: "/desk",
  spaces: "/spaces",
  town: "/town",
  board: "/board",
};

/**
 * Retired views and where they now open: Office's successor is Town, and
 * Graph and Tree showed the hierarchy Board now arranges.
 */
const RETIRED_VIEWS: ReadonlyMap<string, WorldView> = new Map([
  ["office", "town"],
  ["graph", "board"],
  ["tree", "board"],
]);

/**
 * A view name, a retired one's successor, or Town. A Map, not an object, so
 * names like `constructor` or `__proto__` are unknown rather than inherited.
 */
function viewNamed(name: unknown): WorldView {
  if (typeof name !== "string") return "town";
  if (WORLD_VIEWS.includes(name as WorldView)) return name as WorldView;
  return RETIRED_VIEWS.get(name) ?? "town";
}

export function parseWorldView(value: unknown): WorldView {
  return viewNamed(value);
}

export function worldViewFromPath(pathname: string): WorldView {
  return viewNamed(pathname.replace(/^\//, ""));
}

/** True when the address is not the canonical one for its view (root, retired or unknown). */
export function worldPathNeedsCanonical(pathname: string) {
  return pathname !== WORLD_VIEW_PATHS[worldViewFromPath(pathname)];
}

export function initialView() {
  return worldViewFromPath(window.location.pathname);
}
