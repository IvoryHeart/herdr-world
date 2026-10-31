import {
  parseAppearanceTarget,
  appearanceKey,
  type AppearanceTarget,
} from "../../../shared/appearance";
import { tabCardKey } from "../../../shared/terminalColor";
import type { BoardDocument, BoardOp } from "./board-store";
import type { WorldSnapshotResult } from "./snapshot";
import { bindingWitnessMatches } from "./binding-resolution";

/** Adopt only witness-less legacy colours; offline/incomplete reads never bind. */
export function legacyAppearanceOps(
  document: BoardDocument,
  result: WorldSnapshotResult,
  isCurrent: (connectionId: string, generation: number) => boolean,
): BoardOp[] {
  const ops: BoardOp[] = [];
  if (
    !Object.keys(document.layout.colors).length &&
    !Object.keys(document.appearance ?? {}).length
  )
    return ops;
  for (const connection of result.connections) {
    const snapshot = connection.snapshot;
    if (
      !snapshot ||
      connection.stale ||
      !connection.actionable ||
      connection.state !== "ready" ||
      connection.snapshot_generation !== connection.generation ||
      !isCurrent(connection.connection_id, connection.generation) ||
      snapshot.coverage.panes !== snapshot.panes.length ||
      snapshot.coverage.tabs !== snapshot.tabs.length ||
      snapshot.coverage.workspaces !== snapshot.workspaces.length
    )
      continue;
    const workspaceIds = new Set(
      snapshot.workspaces.map((workspace) => String(workspace.workspace_id)),
    );
    for (const tab of snapshot.tabs) {
      if (typeof tab.tab_id !== "string") continue;
      const color_key = tabCardKey(
        connection.connection_id,
        tab.tab_id,
        workspaceIds,
      );
      const witness = snapshot.panes
        .filter((pane) => pane.tab_id === tab.tab_id)
        .map((pane) => pane.terminal_id);
      if (
        !witness.length ||
        witness.length > 64 ||
        witness.some((id) => typeof id !== "string" || !id) ||
        new Set(witness).size !== witness.length
      )
        continue;
      const target: AppearanceTarget = {
        connection_id: connection.connection_id,
        kind: "tab",
        native_id: tab.tab_id,
        witness: witness as string[],
        color_key,
      };
      const previous = document.appearance?.[appearanceKey(target)];
      if (
        !previous
          ? Boolean(document.layout.colors[color_key])
          : bindingWitnessMatches(
              { terminals: previous.witness },
              { native_id: target.native_id, terminals: target.witness },
            ) &&
            (previous.color_key !== color_key ||
              [...previous.witness].sort().join("\n") !==
                [...target.witness].sort().join("\n"))
      )
        ops.push({ op: "appearance.set", target, fields: {} });
      if (ops.length >= 128) return ops;
    }
  }
  return ops;
}
export function movedAppearanceOps(
  document: BoardDocument,
  connectionId: string,
  movedTab: string | null,
  moved: {
    tab_id: string;
    panes: readonly { previous: string; current: string }[];
  },
  workspaceIds: ReadonlySet<string>,
): BoardOp[] {
  const panes = new Map(
    moved.panes.map((pane) => [pane.previous, pane.current]),
  );
  return Object.values(document.appearance ?? {}).flatMap(
    (record): BoardOp[] => {
      if (record.connection_id !== connectionId) return [];
      const nextId =
        record.kind === "tab"
          ? record.native_id === movedTab
            ? moved.tab_id
            : null
          : panes.get(record.native_id);
      if (!nextId || nextId === record.native_id) return [];
      const from = parseAppearanceTarget(record);
      return [
        {
          op: "appearance.relocate",
          from,
          target: {
            ...from,
            native_id: nextId,
            ...(record.kind === "tab"
              ? { color_key: tabCardKey(connectionId, nextId, workspaceIds) }
              : {}),
          },
        },
      ];
    },
  );
}
