import {
  resolveTerminalColor,
  tabCardKey,
} from "../../../shared/terminalColor";
import type {
  BoardDocument,
  BoardOp,
  CardColor,
  MoveColors,
} from "./board-store";

export type ColorEdit = Readonly<{ revision: number; color: CardColor | null }>;

/** Retain explicit intent separately from close cleanup, bounded by live bindings. */
export function trackColorEdits(
  edits: Map<string, ColorEdit>,
  ops: readonly BoardOp[],
  next: BoardDocument,
): void {
  for (const op of ops) {
    if (
      op.op === "appearance.set" &&
      op.fields.color !== undefined &&
      op.target.color_key
    )
      edits.set(op.target.color_key, {
        revision: next.revision,
        color: op.fields.color,
      });
    if (
      op.op === "appearance.relocate" &&
      op.from.color_key &&
      op.target.color_key &&
      op.from.color_key !== op.target.color_key
    ) {
      const edit = edits.get(op.from.color_key);
      edits.delete(op.from.color_key);
      if (edit) edits.set(op.target.color_key, edit);
    }
  }
  if (!edits.size) return;
  const owned = new Set(
    Object.values(next.appearance ?? {}).flatMap((record) =>
      record.color_key ? [record.color_key] : [],
    ),
  );
  for (const key of edits.keys()) if (!owned.has(key)) edits.delete(key);
}

/**
 * A moved tab keeps the colour it showed (shared/terminalColor.ts), chosen,
 * inherited or default: its new tab ID would otherwise give it another
 * default. It is saved as the moved tab's own colour. Read from
 * `colors.before`, taken before the move, so a close of the old tab seen
 * during the move cannot lose it.
 */
export function colorFollowOps(
  connectionId: string,
  movedTab: string,
  moved: {
    tab_id: string;
    workspace_id?: string;
    source_workspace_id?: string;
  },
  colors: MoveColors,
): BoardOp[] {
  const { before, workspaceIds } = colors;
  const { source_workspace_id: from, workspace_id: to } = moved;
  if (!from || !to) return [];
  // A spawned tab's inherited colour follows its terminals, not its tab ID.
  if (
    colors.inherited &&
    !before[tabCardKey(connectionId, movedTab, workspaceIds)]
  )
    return [];
  const previousKey = tabCardKey(connectionId, movedTab, workspaceIds);
  const nextKey = tabCardKey(connectionId, moved.tab_id, workspaceIds);
  if (previousKey === nextKey) return [];
  const { color } = resolveTerminalColor(before, {
    connectionId,
    workspaceId: from,
    tabId: movedTab,
    workspaceIds,
  });
  // Always as the tab's own colour: one that merely matched the new room's
  // would otherwise be lost to it, and change when that room is recoloured.
  const ops: BoardOp[] = [
    { op: "card.color", key: nextKey, color: color as CardColor },
  ];
  if (before[previousKey])
    ops.push({ op: "card.color", key: previousKey, color: null });
  return ops;
}
