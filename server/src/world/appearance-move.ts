import {
  continuingAppearance,
  parseAppearanceTarget,
  type AppearanceRecord,
} from "../../../shared/appearance";
import { tabCardKey } from "../../../shared/terminalColor";
import type { BoardDocument, BoardOp } from "./board-store";

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
  changed: (key: string) => boolean,
): BoardDocument["layout"]["colors"] {
  const colors = { ...before };
  for (const record of Object.values(current.appearance ?? {})) {
    const key = record.color_key;
    if (record.connection_id !== connectionId || !key || !changed(key))
      continue;
    const color = current.layout.colors[key];
    if (color) colors[key] = color;
    else delete colors[key];
  }
  return colors;
}
