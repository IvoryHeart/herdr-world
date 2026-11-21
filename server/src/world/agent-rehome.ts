import { interestKey } from "../../../shared/interest";
import { appearanceKey } from "../../../shared/appearance";
import { type TerminalRef } from "../../../shared/relations";
import { cardKey } from "../../../shared/terminalColor";
import type { AgentAddress } from "../../../shared/agentMove";
import type { BoardDocument } from "./board-types";

/** Explicit, admitted identity transfer; ordinary observations never infer a move. */
export function rehomeAgent(
  document: BoardDocument,
  from: AgentAddress,
  to: AgentAddress,
  previous?: AgentAddress,
  remaining: string[] = [],
): void {
  if (remaining.length > 64 || remaining.some((id) => !id || id.length > 512))
    throw new Error("Invalid remaining desk witnesses");
  for (const ref of [from, to]) {
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
  }
  const oldKey = from.color_key,
    newKey = to.color_key;
  const boundTab = Object.values(document.appearance ?? {}).find(
    (a) =>
      a.connection_id === from.connection_id &&
      a.kind === "tab" &&
      a.native_id === from.tab_id,
  );
  if (boundTab && !boundTab.witness.includes(from.terminal_id))
    throw new Error("The old desk belongs to a different terminal.");
  const sameTerminal = (r: TerminalRef) =>
    (r.connection_id === from.connection_id &&
      r.terminal_id === from.terminal_id) ||
    (previous !== undefined &&
      r.connection_id === previous.connection_id &&
      r.terminal_id === previous.terminal_id);
  const replaceRef = (r: TerminalRef): TerminalRef =>
    sameTerminal(r)
      ? { connection_id: to.connection_id, terminal_id: to.terminal_id }
      : r;
  if (oldKey !== newKey) {
    for (const map of [
      document.layout.anchors,
      document.layout.offsets,
      document.layout.pinned,
      document.layout.colors,
      document.layout.desk_pins,
    ]) {
      if (Object.hasOwn(map, oldKey)) {
        Object.assign(map, { [newKey]: structuredClone(map[oldKey]) });
        if (!remaining.length) delete map[oldKey];
      }
    }
    document.layout.folded = [
      ...new Set([
        ...document.layout.folded.map((key) =>
          key === oldKey && !remaining.length ? newKey : key,
        ),
        ...(remaining.length && document.layout.folded.includes(oldKey)
          ? [newKey]
          : []),
      ]),
    ];
  }
  const oldInterest = interestKey(from.connection_id, from.terminal_id),
    newInterest = interestKey(to.connection_id, to.terminal_id);
  if (oldInterest !== newInterest && document.layout.interest[oldInterest]) {
    document.layout.interest[newInterest] =
      document.layout.interest[oldInterest]!;
    delete document.layout.interest[oldInterest];
  }
  for (const [key, record] of Object.entries(document.appearance ?? {})) {
    if (
      record.connection_id !== from.connection_id ||
      !record.witness.includes(from.terminal_id)
    )
      continue;
    if (
      (record.kind === "tab" && record.native_id !== from.tab_id) ||
      (record.kind === "pane" && record.native_id !== from.pane_id)
    )
      continue;
    if (record.kind === "tab" && remaining.length && oldKey !== newKey)
      document.appearance![key] = { ...record, witness: remaining };
    else delete document.appearance![key];
    const next = {
      ...record,
      connection_id: to.connection_id,
      native_id: record.kind === "tab" ? to.tab_id : to.pane_id,
      witness:
        record.kind === "tab" && oldKey === newKey
          ? [...new Set([to.terminal_id, ...remaining])]
          : [to.terminal_id],
      ...(record.kind === "tab" ? { color_key: newKey } : {}),
    };
    document.appearance![appearanceKey(next)] = next;
  }
  for (const string of document.strings) {
    let moved = false;
    for (const side of [string.from, string.to]) {
      if (!("anchor" in side)) continue;
      const a = side.anchor;
      if (
        a.connection_id !== from.connection_id ||
        !a.witness.includes(from.terminal_id) ||
        a.kind === "workspace"
      )
        continue;
      if (a.kind === "tab" && a.native_id !== from.tab_id) continue;
      side.anchor = {
        connection_id: to.connection_id,
        kind: a.kind,
        native_id: a.kind === "tab" ? to.tab_id : to.pane_id,
        witness: [to.terminal_id],
      };
      moved = true;
    }
    if (moved) delete string.detached;
  }
  document.relations.spawns = document.relations.spawns.map((claim) => ({
    ...claim,
    child: replaceRef(claim.child),
    parent: replaceRef(claim.parent),
    ...(sameTerminal(claim.parent)
      ? {
          moved_from: [
            ...(claim.moved_from ?? []),
            {
              connection_id: claim.parent.connection_id,
              terminal_id: claim.parent.terminal_id,
            },
          ]
            .filter(
              (ref) =>
                ref.connection_id !== to.connection_id ||
                ref.terminal_id !== to.terminal_id,
            )
            .slice(-64),
        }
      : {}),
    generation: sameTerminal(claim.child) ? to.generation : claim.generation,
  }));
  // Pane cards have separate Board positions when the desk was expanded.
  const oldPane = cardKey(from.connection_id, from.pane_id),
    newPane = cardKey(to.connection_id, to.pane_id);
  if (oldPane !== oldKey && oldPane !== newPane)
    for (const map of [
      document.layout.anchors,
      document.layout.offsets,
      document.layout.pinned,
    ])
      if (map[oldPane]) {
        map[newPane] = map[oldPane]!;
        delete map[oldPane];
      }
}
