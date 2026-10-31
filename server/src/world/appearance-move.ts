import {
  continuingAppearance,
  parseAppearanceTarget,
  type AppearanceRecord,
  appearanceKey,
  type AppearanceFields,
  type AppearanceTarget,
} from "../../../shared/appearance";
import { tabCardKey } from "../../../shared/terminalColor";
import type { BoardDocument, BoardOp, CardColor } from "./board-store";
import type { AppearanceChanges } from "./appearance-edits";

/** Replay the latest field writes after alias relocation, including explicit resets. */
export function moveAppearanceEditOps(
  document: BoardDocument,
  ops: readonly BoardOp[],
  changes: AppearanceChanges,
  movedTab: {
    connectionId: string;
    from: string;
    to: string;
    workspaceIds: ReadonlySet<string>;
  } | null,
): BoardOp[] {
  const pairs = new Map<
    string,
    { sources: AppearanceTarget[]; target: AppearanceTarget }
  >();
  for (const op of ops) {
    if (op.op !== "appearance.relocate") continue;
    const key = appearanceKey(op.target),
      previous = pairs.get(key);
    pairs.set(key, {
      sources: [...(previous?.sources ?? []), op.from],
      target: op.target,
    });
  }
  if (movedTab) {
    const key = appearanceKey({
      connection_id: movedTab.connectionId,
      kind: "tab",
      native_id: movedTab.to,
    });
    const target = document.appearance?.[key];
    // A first destination save can exist without any source appearance to relocate.
    if (
      target &&
      !pairs.has(key) &&
      ops.some((op) => op.op === "card.color" && op.key === target.color_key)
    ) {
      const from = document.appearance?.[
        appearanceKey({ ...target, native_id: movedTab.from })
      ] ?? {
        ...target,
        native_id: movedTab.from,
        color_key: tabCardKey(
          movedTab.connectionId,
          movedTab.from,
          movedTab.workspaceIds,
        ),
      };
      pairs.set(key, { sources: [from], target });
    }
  }
  return [...pairs.values()].flatMap(({ sources, target }): BoardOp[] => {
    const candidates = [
      changes(target),
      ...sources
        .filter((from) => appearanceKey(from) !== appearanceKey(target))
        .map(changes),
    ];
    const fields: AppearanceFields = Object.fromEntries(
      (["color", "status", "avatar"] as const).flatMap((field) => {
        const latest = candidates.reduce<
          ReturnType<AppearanceChanges>[typeof field]
        >((latest, candidate) => {
          const write = candidate[field];
          return write && (!latest || write.revision > latest.revision)
            ? write
            : latest;
        }, undefined);
        return latest ? [[field, latest.value]] : [];
      }),
    );
    return Object.keys(fields).length
      ? [{ op: "appearance.set", target, fields }]
      : [];
  });
}

/** A current native list gates both appearance and the colour a move carries. */
export function appearanceForMove(
  document: BoardDocument,
  connectionId: string,
  panes: readonly Record<string, unknown>[],
  movedTab: string | null = null,
  moved?: {
    tab_id: string;
    panes: readonly { previous: string; current: string }[];
  },
): BoardDocument {
  const appearance: Record<string, AppearanceRecord> = {},
    colors = { ...document.layout.colors };
  for (const [key, record] of Object.entries(document.appearance ?? {})) {
    if (record.connection_id !== connectionId) {
      appearance[key] = record;
      continue;
    }
    const nativeId =
      record.kind === "tab"
        ? record.native_id === movedTab && moved
          ? moved.tab_id
          : record.native_id
        : (moved?.panes.find((pane) => pane.previous === record.native_id)
            ?.current ?? record.native_id);
    const witness = panes
      .filter((pane) =>
        record.kind === "tab"
          ? pane.tab_id === nativeId
          : pane.pane_id === nativeId,
      )
      .flatMap((pane) =>
        typeof pane.terminal_id === "string" ? [pane.terminal_id] : [],
      );
    if (continuingAppearance(record, { witness })) appearance[key] = record;
    else if (record.color_key) delete colors[record.color_key];
  }
  return { ...document, appearance, layout: { ...document.layout, colors } };
}
/** Compensation may allocate new IDs: require positive terminal evidence, as Board anchors do. */
export function reconciledAppearanceOps(
  document: BoardDocument,
  connectionId: string,
  topology: readonly { terminal_id: string; pane_id: string; tab_id: string }[],
  workspaceIds: ReadonlySet<string>,
): BoardOp[] {
  const byTerminal = new Map(topology.map((pane) => [pane.terminal_id, pane]));
  return Object.values(document.appearance ?? {}).flatMap(
    (record): BoardOp[] => {
      if (record.connection_id !== connectionId) return [];
      const observed = record.witness.flatMap((id) =>
        byTerminal.has(id) ? [byTerminal.get(id)!] : [],
      );
      if (
        !observed.length ||
        (record.kind === "tab" && observed.length !== record.witness.length)
      )
        return [];
      const nativeIds = new Set(
        observed.map((pane) =>
          record.kind === "tab" ? pane.tab_id : pane.pane_id,
        ),
      );
      if (nativeIds.size !== 1) return [];
      const [native_id] = [...nativeIds];
      if (!native_id || native_id === record.native_id) return [];
      const from = parseAppearanceTarget(record);
      const color_key =
        record.kind === "tab"
          ? tabCardKey(connectionId, native_id, workspaceIds)
          : undefined;
      const color = record.color_key
        ? document.layout.colors[record.color_key]
        : undefined;
      return [
        ...(color &&
        color_key &&
        record.color_key &&
        color_key !== record.color_key
          ? [
              { op: "card.color" as const, key: color_key, color },
              { op: "card.color" as const, key: record.color_key, color: null },
            ]
          : []),
        {
          op: "appearance.relocate",
          from,
          target: { ...from, native_id, ...(color_key ? { color_key } : {}) },
        },
      ];
    },
  );
}

/** Explicit field edits win; a Herdr close is not an operator's reset. */
export function capturedMoveColors(
  before: BoardDocument["layout"]["colors"],
  current: BoardDocument,
  connectionId: string,
  changed: (key: string) => CardColor | null | undefined,
): BoardDocument["layout"]["colors"] {
  const colors = { ...before };
  for (const record of Object.values(current.appearance ?? {})) {
    const key = record.color_key;
    if (record.connection_id !== connectionId || !key) continue;
    const color = changed(key);
    if (color === undefined) continue;
    if (color) colors[key] = color;
    else delete colors[key];
  }
  return colors;
}
