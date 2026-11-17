import type { InspectorView } from "../workspaceResource";

/** The views that read the agent's worktree. */
const WORKTREE_VIEWS: ReadonlySet<InspectorView> = new Set([
  "files",
  "changes",
  "commits",
]);

/** Status stays outside the inert resource body and never overlays its editor. */
export function WorkspaceInspectorStatus({
  stale,
  worktreeStale = false,
  view,
  available,
}: {
  stale: boolean;
  /** The agent's worktree is being re-read; only its views say so. */
  worktreeStale?: boolean;
  view?: InspectorView;
  available: boolean;
}) {
  return (
    <>
      {stale ? (
        <div className="world-inspector-stale" role="status">
          Disconnected · Showing last observation
        </div>
      ) : worktreeStale && view && WORKTREE_VIEWS.has(view) ? (
        <div className="world-inspector-stale" role="status">
          Worktree changed · Showing last observation
        </div>
      ) : null}
      {!available ? (
        <div className="workspace-inspector-unavailable">
          <strong>Checkout unavailable</strong>
          <span>
            The workspace used to route this Inspector is no longer open.
          </span>
        </div>
      ) : null}
    </>
  );
}
