import { createHash } from "node:crypto";
import {
  relationsOf,
  spawnParents,
  terminalKey,
} from "../../../shared/relations";
import { groupObject } from "../../../shared/groups";
import { groupSnapshotObservations } from "./group-observations";
import { executeTownMove, type TownMoveContext } from "./town-move";
import type { MoveOutcome } from "./desk-move";
import type { GroupMoveRequest } from "./world-cli-groups";
import { CliError } from "./world-cli-errors";

type Pane = {
  pane_id: string;
  terminal_id: string;
  tab_id: string;
  workspace_id: string;
};
const records = (value: unknown, key: string): Record<string, unknown>[] => {
  const rows = groupObject(value) ? value[key] : undefined;
  if (!Array.isArray(rows) || rows.some((row) => !groupObject(row)))
    throw new CliError(
      "unavailable",
      `Herdr ${key} could not be read completely; no move was made`,
    );
  return rows;
};
const validId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 512 &&
  !/\p{Cc}/u.test(value);
const label = (row: Record<string, unknown>, fallback: string): string =>
  typeof row.label === "string" && row.label && !/\p{Cc}/u.test(row.label)
    ? row.label
    : fallback;

/** Read the full effect, rather than the bounded display snapshot. */
async function preview(context: TownMoveContext, request: GroupMoveRequest) {
  if (!context.isCurrent())
    throw new CliError("refused", "The host reconnected. Read Groups again.");
  const relationsBefore = context.board.get().relations;
  const [paneResult, agentResult, workspaceResult] = await Promise.all([
    context.call("pane.list", {}),
    context.call("agent.list", {}),
    context.call("workspace.list", {}),
  ]);
  const panes = records(paneResult, "panes");
  if (
    panes.some(
      (pane) =>
        ![pane.pane_id, pane.terminal_id, pane.tab_id, pane.workspace_id].every(
          validId,
        ),
    )
  )
    throw new CliError(
      "unavailable",
      "Herdr returned incomplete pane identities; no move was made",
    );
  const source = panes.filter(
    (pane) =>
      pane.pane_id === request.pane_id &&
      pane.terminal_id === request.terminal_id &&
      pane.tab_id === request.tab_id,
  );
  if (source.length !== 1)
    throw new CliError(
      "refused",
      "The selected agent or desk changed. Read Groups again.",
    );
  const sourceRoom = source[0]!.workspace_id as string;
  const destinationRoom = request.destination_workspace_id;
  const workspaces = records(workspaceResult, "workspaces");
  const room = workspaces.find(
    (workspace) => workspace.workspace_id === destinationRoom,
  );
  if (!room)
    throw new CliError(
      "refused",
      "The destination room changed. Read Groups again.",
    );
  const sourceTabs = records(
    await context.call("tab.list", { workspace_id: sourceRoom }),
    "tabs",
  );
  const destinationTabs =
    sourceRoom === destinationRoom
      ? sourceTabs
      : records(
          await context.call("tab.list", { workspace_id: destinationRoom }),
          "tabs",
        );
  const sourceTab = sourceTabs.find((tab) => tab.tab_id === request.tab_id);
  const destinationTab =
    request.kind === "desk"
      ? destinationTabs.find((tab) => tab.tab_id === request.destination_id)
      : undefined;
  if (!sourceTab || (request.kind === "desk" && !destinationTab))
    throw new CliError("refused", "The desks changed. Read Groups again.");
  const agents = records(agentResult, "agents");
  const observed = groupSnapshotObservations([
    {
      connection_id: context.connectionId,
      generation: context.generation,
      snapshot_generation: context.generation,
      state: "ready",
      stale: false,
      actionable: true,
      snapshot: {
        panes,
        agents,
        workspaces,
        tabs: sourceTabs.concat(destinationTabs),
      },
    },
  ])[0]!;
  const affected = panes.filter((pane) =>
    request.kind === "room"
      ? pane.tab_id === request.tab_id
      : pane.pane_id === request.pane_id,
  ) as Pane[];
  if (
    new Set(affected.map((pane) => pane.terminal_id)).size !==
      affected.length ||
    new Set(affected.map((pane) => pane.pane_id)).size !== affected.length
  )
    throw new CliError(
      "refused",
      "The desk has ambiguous identities; no move was made",
    );
  const parents = spawnParents(
    relationsOf(relationsBefore, [
      {
        connection_id: context.connectionId,
        generation: context.generation,
        current: true,
        complete: true,
        panes: panes as Pane[],
      },
    ]),
  );
  const inheritedColor = affected.some((pane) => {
    const parent = parents.get(
      terminalKey({
        connection_id: context.connectionId,
        terminal_id: pane.terminal_id,
      }),
    );
    return (
      parent?.connection_id === context.connectionId &&
      panes.some(
        (candidate) =>
          candidate.terminal_id === parent.terminal_id &&
          candidate.tab_id !== request.tab_id,
      )
    );
  });
  const members = affected
    .map((pane) => {
      const terminal = observed.terminals.find(
        (terminal) => terminal.paneId === pane.pane_id,
      )!;
      return {
        ...pane,
        name:
          terminal.name ?? `terminal ${pane.terminal_id} (name unavailable)`,
        session: terminal.sessionFingerprint ?? null,
      };
    })
    .sort((a, b) => a.pane_id.localeCompare(b.pane_id));
  const target =
    request.kind === "room"
      ? label(room, request.destination_id)
      : label(destinationTab!, request.destination_id);
  const summary =
    request.kind === "room"
      ? `Moves desk ${label(sourceTab, request.tab_id)} (${members.length} agents: ${members.map((member) => member.name).join(", ")}) to room ${target}`
      : `Moves agent ${members[0]!.name} from desk ${label(sourceTab, request.tab_id)} to desk ${target} in room ${label(room, destinationRoom)}`;
  const effect = {
    connection_id: context.connectionId,
    generation: context.generation,
    kind: request.kind,
    destination_id: request.destination_id,
    destination_workspace_id: destinationRoom,
    source_room: sourceRoom,
    source_tab: request.tab_id,
    members,
    summary,
    allow_close_room: request.allow_close_room,
  };
  const plan = createHash("sha256")
    .update(JSON.stringify(effect))
    .digest("hex");
  if (!context.isCurrent())
    throw new CliError("refused", "The host reconnected. Read Groups again.");
  return {
    result: { status: "preview" as const, plan, summary, effect },
    inheritedColor,
  };
}

export function groupMoveSummary(result: MoveOutcome): string {
  if (result.status === "moved")
    return `Done · ${result.panes.map((pane) => `${pane.previous} → ${pane.current}`).join(", ")} at desk ${result.tab_id} in room ${result.workspace_id}`;
  if (result.status === "refused") return `Not done · ${result.message}`;
  const outcome =
    result.topology_known !== true
      ? "Unknown"
      : result.rolled_back
        ? "Not done (agents returned; layout may differ)"
        : "Partly done";
  const locations = result.topology
    .map(
      (pane) => `${pane.terminal_id} at desk ${pane.tab_id} (${pane.pane_id})`,
    )
    .join(", ");
  return `${outcome} · ${result.message}${locations ? ` · Observed: ${locations}` : " · No current locations confirmed"}${result.topology_known !== true ? ". Do not retry automatically." : ""}`;
}

/** Captured context and shared queue are supplied by the service, never RPC. */
export async function runGroupMove(
  context: TownMoveContext,
  request: GroupMoveRequest,
) {
  if (
    request.connection_id !== context.connectionId ||
    request.generation !== context.generation
  )
    throw new CliError(
      "refused",
      "The selected host generation changed. Read Groups again.",
    );
  if (request.preview) return (await preview(context, request)).result;
  if (!request.expected_plan || !/^[a-f0-9]{64}$/.test(request.expected_plan))
    throw new CliError("refused", "Preview this Herdr move before acting");
  const result = await executeTownMove(context, async () => {
    const { result: current, inheritedColor } = await preview(context, request);
    if (current.plan !== request.expected_plan)
      return {
        status: "refused",
        reason: "desk_changed",
        message:
          "The move changed after the preview. Read Groups again; no move was made.",
      };
    return request.kind === "room"
      ? {
          kind: "desk",
          inherited_color: inheritedColor,
          tab_id: request.tab_id,
          workspace_id: request.destination_id,
          allow_close_room: request.allow_close_room,
          expected_source_workspace_id: current.effect.source_room,
          expected_terminal_ids: current.effect.members.map(
            (member) => member.terminal_id,
          ),
        }
      : {
          kind: "pane",
          pane_id: request.pane_id,
          tab_id: request.destination_id,
          allow_close_room: request.allow_close_room,
          expected_source_tab_id: request.tab_id,
          expected_source_workspace_id: current.effect.source_room,
          expected_workspace_id: request.destination_workspace_id,
          expected_terminal_id: request.terminal_id,
        };
  });
  const response = { ...result, summary: groupMoveSummary(result) };
  if (result.status !== "moved")
    throw new CliError(
      result.status === "refused" ? "refused" : "unavailable",
      response.summary,
      response,
    );
  return response;
}
