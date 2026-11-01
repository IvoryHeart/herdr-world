import type { SourceBinding } from "../world/binding-types";
import { bindingWitnessMatches } from "../world/binding-resolution";
import type { LegacyBindingCapture } from "./legacy-bindings";

export type LegacyBindingRow = {
  key: string;
  ended: number;
  binding: SourceBinding;
};
const witnessKey = (capture: LegacyBindingCapture["input"], terminal: string) =>
  JSON.stringify([
    capture.adapter,
    capture.instance,
    capture.kind,
    capture.policy,
    capture.slot,
    terminal,
  ]);

/** Plan against the complete immutable record set; neither input order nor pages choose identity. */
export function planLegacyBindings(
  rows: readonly LegacyBindingRow[],
  captures: readonly LegacyBindingCapture[],
): Map<string, LegacyBindingRow> {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const currentKeys = new Set(captures.map((capture) => capture.key));
  const witnesses = new Map<string, LegacyBindingRow[]>();
  for (const row of rows) {
    if (
      currentKeys.has(row.key) ||
      row.binding.state === "ended" ||
      !["appearance", "tab-colour"].includes(row.binding.policy)
    )
      continue;
    for (const terminal of row.binding.evidence.terminals) {
      const key = witnessKey(row.binding, terminal);
      const list = witnesses.get(key) ?? [];
      list.push(row);
      witnesses.set(key, list);
    }
  }
  const incoming = new Map<
    string,
    { count: number; candidate?: LegacyBindingRow }
  >();
  const outgoing = new Map<string, number>();
  for (const capture of captures) {
    const candidates = new Set(
      capture.input.evidence.terminals.flatMap(
        (terminal) => witnesses.get(witnessKey(capture.input, terminal)) ?? [],
      ),
    );
    let count = 0,
      candidate: LegacyBindingRow | undefined;
    for (const row of candidates) {
      if (
        capture.ended ||
        (capture.input.record_id &&
          capture.input.record_id !== row.binding.record_id) ||
        !bindingWitnessMatches(row.binding.evidence, {
          native_id: capture.input.native_id,
          terminals: capture.input.evidence.terminals,
          session: capture.input.evidence.session,
        })
      )
        continue;
      count++;
      candidate = row;
      outgoing.set(row.binding.id, (outgoing.get(row.binding.id) ?? 0) + 1);
    }
    incoming.set(capture.key, { count, candidate });
  }
  const plan = new Map<string, LegacyBindingRow>();
  for (const capture of captures) {
    const existing = byKey.get(capture.key);
    if (existing) {
      plan.set(capture.key, existing);
      continue;
    }
    const match = incoming.get(capture.key)!;
    if (
      match.count === 1 &&
      match.candidate &&
      outgoing.get(match.candidate.binding.id) === 1
    )
      plan.set(capture.key, match.candidate);
  }
  return plan;
}
