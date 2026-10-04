import { connectionSnapshot, type State } from "../store";

/** Exactly the session fields consumed by endpointCreationReason. */
export function officeCreationInputsEqual(
  previous: State,
  next: State,
  hosts: readonly { connectionId: string }[],
) {
  return hosts.every(({ connectionId }) => {
    const a = connectionSnapshot(previous, connectionId);
    const b = connectionSnapshot(next, connectionId);
    // Missing/cached hosts use freshly allocated shared-mode fallbacks.
    // Shared navigation has no endpoint creation restriction to invalidate.
    if (a.navigationMode === "shared" && b.navigationMode === "shared")
      return true;
    return (
      a.navigationMode === b.navigationMode &&
      a.workspaces === b.workspaces &&
      a.browserNavigation === b.browserNavigation &&
      a.panes === b.panes &&
      a.endpointAvailability === b.endpointAvailability
    );
  });
}
