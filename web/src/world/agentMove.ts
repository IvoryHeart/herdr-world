import type {
  AgentAddress,
  AgentMoveDestination,
} from "../../../shared/agentMove";
import type { WorldRuntimeConnection } from "./runtimeStore";
export function agentMoveDestinations(
  connections: readonly WorldRuntimeConnection[],
  sourceConnection: string,
  sourceWorkspace?: string,
) {
  return connections.flatMap((host) =>
    host.actionable &&
    !host.stale &&
    host.state === "ready" &&
    host.snapshotGeneration === host.generation
      ? (host.snapshot?.workspaces ?? [])
          .filter(
            (room) =>
              host.connectionId !== sourceConnection ||
              (sourceWorkspace !== undefined &&
                room.workspace_id !== sourceWorkspace),
          )
          .map((room) => ({
            destination: {
              connection_id: host.connectionId,
              generation: host.generation,
              workspace_id: room.workspace_id,
            } satisfies AgentMoveDestination,
            label: `${host.label} · ${host.runtime === "herdr-core" ? "herdr-core" : "Herdr TUI"} · ${room.label || "Room"}`,
          }))
      : [],
  );
}
let previewBusy: boolean | undefined;
/** Testing-only refusal path. Removed from the address immediately, once per page. */
export function moveBusyPreview() {
  if (previewBusy !== undefined) return previewBusy;
  previewBusy = false;
  if (typeof location === "undefined") return false;
  const url = new URL(location.href);
  if (!url.searchParams.has("agentMoveBusy")) return false;
  previewBusy = true;
  url.searchParams.delete("agentMoveBusy");
  history.replaceState(history.state, "", url);
  return true;
}
export type AgentMoveOutcome = {
  status: "moved" | "refused" | "rolled_back" | "uncertain";
  message: string;
  target?: AgentAddress;
};
