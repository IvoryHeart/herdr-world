import {
  resolveTerminalColor,
  tabCardKey,
} from "../../../shared/terminalColor";
import type { BoardOp, CardColor, MoveColors } from "./board-store";
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
