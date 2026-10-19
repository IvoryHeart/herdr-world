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
const RETIRED_VIEWS: Readonly<Record<string, WorldView>> = {
  office: "town",
  graph: "board",
  tree: "board",
};

export function parseWorldView(value: unknown): WorldView {
  if (WORLD_VIEWS.includes(value as WorldView)) return value as WorldView;
  return (typeof value === "string" && RETIRED_VIEWS[value]) || "town";
}

export function worldViewFromPath(pathname: string): WorldView {
  const name = pathname.replace(/^\//, "");
  if (WORLD_VIEWS.includes(name as WorldView)) return name as WorldView;
  return RETIRED_VIEWS[name] ?? "town";
}

/** True when the address is not the canonical one for its view (root, retired or unknown). */
export function worldPathNeedsCanonical(pathname: string) {
  return pathname !== WORLD_VIEW_PATHS[worldViewFromPath(pathname)];
}

export function initialView() {
  return worldViewFromPath(window.location.pathname);
}
