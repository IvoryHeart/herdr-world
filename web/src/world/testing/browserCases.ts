export const hostFilterCases = [
  ...[1440, 390].flatMap((width) => [
    ...[
      "pending-inspector-scope",
      "pending-inspector-unmount",
      "pending-inspector-timeout",
      "pending-inspector-delayed",
    ].map((operation) => ({ width, operation, view: "spaces" })),
    { width, operation: "spaces-navigator", view: "spaces" },
    { width, operation: "bare-navigator", view: "town" },
  ]),
  ...[1440, 390].flatMap((width) =>
    // Town's room tap only zooms (it never opens an Inspector), so the
    // workspace-to-Files check runs through Board.
    ["board"].map((view) => ({
      width,
      operation: "room",
      view,
    })),
  ),
  ...[1440, 390].flatMap((width) =>
    [
      "filters",
      "cold-host",
      "navigator",
      "delayed-catalogue",
      "empty-catalogue",
      "nonempty-filter",
      "actions",
      "watches",
      "watch-unavailable",
      "spaces",
      "hidden-spaces",
      "hidden-selection",
      "global-creation",
      "global-creation-retry",
      "file-download-error",
      "context-menu-pull-failure",
      "file-mutation-interruption",
      "file-delete-retirement",
      "file-upload-retirement",
      "global-creation-retirement",
      "notifications",
      "shortcut",
      "focus-tab",
      "worktree",
      "worktree-files",
      "worktree-changes",
      "worktree-resource-retirement",
      "worktree-resource-disposal",
      "worktree-resource-rejection",
      "worktree-resource-closed-refresh",
      "worktree-resource-closed-retry",
      "worktree-resource-validation-failure",
      "worktree-resource-cold",
      "worktree-resource-timeout",
    ].map((operation) => ({ width, operation, view: "board" })),
  ),
  ...[
    "open-all",
    "filtered-open-all",
    "arrangement-focus",
    "arrangement-retirement",
    "close-all",
  ].map((operation) => ({ width: 1440, operation, view: "board" })),
  { width: 1440, operation: "cold-master", view: "town" },
  { width: 1440, operation: "cold-master-connect", view: "town" },
  ...[1440, 390].flatMap((width) =>
    ["town"].flatMap((view) =>
      [
        "actions",
        "cold-host",
        "navigator",
        "watches",
        "hidden-spaces",
        "hidden-selection",
        "global-creation",
        "global-creation-retirement",
        "notifications",
        "worktree",
        "spaces",
        "shortcut",
        "focus-tab",
      ].map((operation) => ({ width, operation, view })),
    ),
  ),
  ...["town", "board"].flatMap((view) =>
    ["open-all", "filtered-open-all", "compact-arrangement", "close-all"].map(
      (operation) => ({ width: 390, operation, view }),
    ),
  ),
];

export const hostFilterGroups = [
  "visibility",
  "navigation",
  "actions",
  "creation",
  "resources",
  "arrangement",
  "pending",
  "timeouts",
  "cold",
  "inspector-timeout",
] as const;
export type HostFilterGroup = (typeof hostFilterGroups)[number];
export type HostFilterCase = (typeof hostFilterCases)[number];

export function hostFilterGroup({
  operation,
}: HostFilterCase): HostFilterGroup {
  if (
    operation === "worktree-resource-cold" ||
    operation.startsWith("cold-master")
  )
    return "cold";
  if (operation === "pending-inspector-timeout") return "inspector-timeout";
  if (operation === "worktree-resource-timeout") return "timeouts";
  if (operation.startsWith("pending-inspector")) return "pending";
  if (
    [
      "open-all",
      "filtered-open-all",
      "compact-arrangement",
      "close-all",
      "arrangement-focus",
      "arrangement-retirement",
    ].includes(operation)
  )
    return "arrangement";
  if (
    operation.startsWith("worktree") ||
    operation.startsWith("file-") ||
    operation.startsWith("context-menu-")
  )
    return "resources";
  if (operation.startsWith("global-creation")) return "creation";
  if (
    [
      "navigator",
      "bare-navigator",
      "spaces-navigator",
      "shortcut",
      "focus-tab",
    ].includes(operation)
  )
    return "navigation";
  if (
    [
      "actions",
      "watches",
      "watch-unavailable",
      "cold-host",
      "notifications",
    ].includes(operation)
  )
    return "actions";
  return "visibility";
}

export const productionContextGroups = [
  "uncertain",
  "board",
  "town",
  "animated",
] as const;
export type ProductionContextGroup = (typeof productionContextGroups)[number];
export const productionContextCases = [
  { view: "uncertain", entry: "typing" },
  { view: "uncertain", entry: "fallback" },
  { view: "uncertain", entry: "popup" },
  { view: "board", entry: "" },
  { view: "town", entry: "" },
  { view: "town", entry: "animated" },
].flatMap((item) => [1440, 390].map((width) => ({ ...item, width })));
export function productionContextGroup({
  view,
  entry,
}: (typeof productionContextCases)[number]): ProductionContextGroup {
  return entry === "animated" ? "animated" : (view as ProductionContextGroup);
}
