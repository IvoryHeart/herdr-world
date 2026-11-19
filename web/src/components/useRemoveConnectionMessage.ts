import { ideStopEnds } from "../world/code/IdeServers";
import { useIdeServersOn } from "../world/code/useIdeStatus";

/**
 * The Remove Connection confirmation. Removing a connection stops the IDE
 * servers World started on it, so it says so first, with what ends.
 */
export function useRemoveConnectionMessage(
  target: { id: string; label: string } | null,
) {
  const ideServers = useIdeServersOn(target?.id ?? null);
  if (!target) return "Remove this connection?";
  const ide = ideServers
    ? ` It stops ${ideServers === 1 ? "the IDE server" : `the ${ideServers} IDE servers`} World started on it. ${ideStopEnds(ideServers)}`
    : "";
  return `Remove connection "${target.label}"? This disconnects Herdr World but does not stop the Herdr server.${ide}`;
}
