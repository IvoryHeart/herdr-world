import {
  parseAppearanceTarget,
  appearanceKey,
  type AppearanceTarget,
} from "../../../shared/appearance";
import { tabCardKey } from "../../../shared/terminalColor";
import type { BoardDocument, BoardOp } from "./board-store";
import type { WorldSnapshotResult } from "./snapshot";
import { bindingWitnessMatches } from "./binding-resolution";

type LegacyAppearanceObservation = {
  connection_id: string;
  generation: number;
  current: boolean;
  complete: boolean;
  targets: (AppearanceTarget & { color_key: string })[];
};

/** Keep source fences and native witnesses; observation labels and agent metadata are irrelevant. */
export function legacyAppearanceObservations(
  result: WorldSnapshotResult,
): LegacyAppearanceObservation[] {
  return result.connections.map((connection) => {
    const snapshot = connection.snapshot;
    const current = Boolean(
      snapshot &&
        !connection.stale &&
        connection.actionable &&
        connection.state === "ready" &&
        connection.snapshot_generation === connection.generation,
    );
    const complete = Boolean(
      snapshot &&
        snapshot.coverage?.panes === snapshot.panes.length &&
        snapshot.coverage?.tabs === snapshot.tabs.length &&
        snapshot.coverage?.workspaces === snapshot.workspaces.length,
    );
    const targets: LegacyAppearanceObservation["targets"] = [];
    if (snapshot && current && complete) {
      const workspaceIds = new Set(
        snapshot.workspaces.map((workspace) => String(workspace.workspace_id)),
      );
      for (const tab of snapshot.tabs) {
        if (typeof tab.tab_id !== "string") continue;
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
        targets.push({
          connection_id: connection.connection_id,
          kind: "tab",
          native_id: tab.tab_id,
          witness: witness as string[],
          color_key: tabCardKey(
            connection.connection_id,
            tab.tab_id,
            workspaceIds,
          ),
        });
      }
    }
    return {
      connection_id: connection.connection_id,
      generation: connection.generation,
      current,
      complete,
      targets,
    };
  });
}

/** Adopt only witness-less legacy colours; offline/incomplete reads never bind. */
export function legacyAppearanceOps(
  document: BoardDocument,
  result: WorldSnapshotResult,
  isCurrent: (connectionId: string, generation: number) => boolean,
): BoardOp[] {
  if (
    !Object.keys(document.layout.colors).length &&
    !Object.keys(document.appearance ?? {}).length
  )
    return [];
  return legacyAppearanceObservationOps(
    document,
    legacyAppearanceObservations(result),
    isCurrent,
  );
}

/** Board-dependent decisions remain inside the committed-state planner. */
export function legacyAppearanceObservationOps(
  document: BoardDocument,
  observations: readonly LegacyAppearanceObservation[],
  isCurrent: (connectionId: string, generation: number) => boolean,
): BoardOp[] {
  const ops: BoardOp[] = [];
  if (
    !Object.keys(document.layout.colors).length &&
    !Object.keys(document.appearance ?? {}).length
  )
    return ops;
  for (const observation of observations) {
    if (
      !observation.current ||
      !observation.complete ||
      !isCurrent(observation.connection_id, observation.generation)
    )
      continue;
    for (const target of observation.targets) {
      const color_key = target.color_key;
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
