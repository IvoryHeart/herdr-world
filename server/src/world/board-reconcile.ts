import type { BoardDocument, BoardEnd, BoardOp } from "./board-store";
import { bindingObservationAmbiguous } from "./binding-resolution";

/**
 * After a move that failed (and maybe rolled back), panes can sit under new
 * IDs. Using only what the outcome positively observed (terminal to pane and
 * tab), a pane anchor whose witnessed terminal was seen takes that pane's ID,
 * and a tab anchor whose witnessed terminals were all seen in one tab takes
 * that tab.
 * Anchors with no observed terminal are left as they are (unresolved).
 */
export function reconcileOps(
  document: BoardDocument,
  connectionId: string,
  topology: readonly { terminal_id: string; pane_id: string; tab_id: string }[],
): BoardOp[] {
  if (
    bindingObservationAmbiguous(
      topology.map((row) => ({
        native_id: row.pane_id,
        terminals: [row.terminal_id],
      })),
    )
  )
    return [];
  const byTerminal = new Map(
    topology.map((entry) => [entry.terminal_id, entry]),
  );
  const rewrite = (end: BoardEnd): BoardEnd => {
    if (!("anchor" in end) || end.anchor.connection_id !== connectionId)
      return end;
    const { anchor } = end;
    const seen = anchor.witness.flatMap((terminal) => {
      const entry = byTerminal.get(terminal);
      return entry ? [entry] : [];
    });
    if (!seen.length) return end;
    if (anchor.kind === "pane") {
      const pane = seen[0]!.pane_id;
      return pane === anchor.native_id
        ? end
        : { anchor: { ...anchor, native_id: pane } };
    }
    if (anchor.kind === "tab") {
      // Only when every witnessed terminal was seen, all in one tab: a
      // partial observation may have missed panes still in the old tab.
      if (seen.length !== anchor.witness.length) return end;
      const tabs = new Set(seen.map((entry) => entry.tab_id));
      const [tab] = [...tabs];
      return tabs.size === 1 && tab !== anchor.native_id
        ? { anchor: { ...anchor, native_id: tab! } }
        : end;
    }
    return end;
  };
  const ops: BoardOp[] = [];
  for (const string of document.strings) {
    const from = rewrite(string.from),
      to = rewrite(string.to);
    if (from !== string.from || to !== string.to)
      ops.push({ op: "string.put", string: { ...string, from, to } });
  }
  return ops;
}
