/** Status stays outside the inert resource body and never overlays its editor. */
export function WorkspaceInspectorStatus({
  stale,
  available,
}: {
  stale: boolean;
  available: boolean;
}) {
  return (
    <>
      {stale ? (
        <div className="world-inspector-stale" role="status">
          Disconnected · Showing last observation
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
