export type WorldView = "desk" | "spaces" | "office" | "tree" | "graph";

export const WORLD_VIEWS: readonly WorldView[] = [
  "desk",
  "office",
  "spaces",
  "tree",
  "graph",
];

export const WORLD_VIEW_PATHS: Record<WorldView, string> = {
  desk: "/desk",
  spaces: "/spaces",
  office: "/office",
  tree: "/tree",
  graph: "/graph",
};

export function parseWorldView(value: unknown): WorldView {
  return WORLD_VIEWS.includes(value as WorldView)
    ? (value as WorldView)
    : "office";
}

export function worldViewFromPath(pathname: string): WorldView {
  if (pathname === "/desk") return "desk";
  if (pathname === "/spaces") return "spaces";
  if (pathname === "/tree") return "tree";
  if (pathname === "/graph") return "graph";
  if (pathname === "/office") return "office";
  return "office";
}

export function initialView() {
  return worldViewFromPath(window.location.pathname);
}
