import { interestKey } from "../../../shared/interest";
import { appearanceKey } from "../../../shared/appearance";
import { type TerminalRef } from "../../../shared/relations";
import { cardKey } from "../../../shared/terminalColor";
import type { AgentAddress } from "../../../shared/agentMove";
import type { BoardDocument } from "./board-types";

/**
 * Carry a moved agent's desk to its new address: layout, colour, pin,
 * appearance, strings and spawn links. Only an explicit move (an admitted
 * agent.rehome op) does this; observations never infer one.
 */
export function rehomeAgent(
  document: BoardDocument,
  from: AgentAddress,
  to: AgentAddress,
): void {
  for (const ref of [from, to])
    for (const key of [
      "connection_id",
      "workspace_id",
      "tab_id",
      "pane_id",
      "terminal_id",
      "color_key",
    ] as const)
      if (typeof ref?.[key] !== "string" || !ref[key] || ref[key].length > 512)
        throw new Error("Invalid agent move address");
  const moveKey = (
    maps: Record<string, unknown>[],
    oldKey: string,
    newKey: string,
  ) => {
    if (oldKey === newKey) return;
    for (const map of maps)
      if (Object.hasOwn(map, oldKey)) {
        map[newKey] = map[oldKey];
        delete map[oldKey];
      }
  };
  const { layout } = document;
  moveKey(
    [
      layout.anchors,
      layout.offsets,
      layout.pinned,
      layout.colors,
      layout.desk_pins,
    ],
    from.color_key,
    to.color_key,
  );
  layout.folded = layout.folded.map((key) =>
    key === from.color_key ? to.color_key : key,
  );
  // Pane cards have their own Board places when the desk was expanded.
  moveKey(
    [layout.anchors, layout.offsets, layout.pinned],
    cardKey(from.connection_id, from.pane_id),
    cardKey(to.connection_id, to.pane_id),
  );
  moveKey(
    [layout.interest],
    interestKey(from.connection_id, from.terminal_id),
    interestKey(to.connection_id, to.terminal_id),
  );
  const ours = (record: {
    connection_id: string;
    kind: string;
    native_id: string;
    witness: string[];
  }) =>
    record.connection_id === from.connection_id &&
    record.witness.includes(from.terminal_id) &&
    (record.kind === "tab"
      ? record.native_id === from.tab_id
      : record.kind === "pane" && record.native_id === from.pane_id);
  const nativeOf = (kind: string) => (kind === "tab" ? to.tab_id : to.pane_id);
  for (const [key, record] of Object.entries(document.appearance ?? {})) {
    if (!ours(record)) continue;
    delete document.appearance![key];
    const next = {
      ...record,
      connection_id: to.connection_id,
      native_id: nativeOf(record.kind),
      witness: [to.terminal_id],
      ...(record.kind === "tab" ? { color_key: to.color_key } : {}),
    };
    document.appearance![appearanceKey(next)] = next;
  }
  for (const string of document.strings) {
    let moved = false;
    for (const side of [string.from, string.to]) {
      if (!("anchor" in side) || !ours(side.anchor)) continue;
      side.anchor = {
        connection_id: to.connection_id,
        kind: side.anchor.kind,
        native_id: nativeOf(side.anchor.kind),
        witness: [to.terminal_id],
      };
      moved = true;
    }
    if (moved) delete string.detached;
  }
  const isFrom = (ref: TerminalRef) =>
    ref.connection_id === from.connection_id &&
    ref.terminal_id === from.terminal_id;
  const toRef = {
    connection_id: to.connection_id,
    terminal_id: to.terminal_id,
  };
  // A child's live token still names the old parent: moved_from says it moved.
  document.relations.spawns = document.relations.spawns.map((claim) => ({
    ...claim,
    child: isFrom(claim.child) ? toRef : claim.child,
    parent: isFrom(claim.parent) ? toRef : claim.parent,
    ...(isFrom(claim.parent)
      ? { moved_from: [...(claim.moved_from ?? []), claim.parent].slice(-64) }
      : {}),
    generation: isFrom(claim.child) ? to.generation : claim.generation,
  }));
}
