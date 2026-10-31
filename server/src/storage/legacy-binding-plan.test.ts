import { expect, test } from "bun:test";
import {
  planLegacyBindings,
  type LegacyBindingRow,
} from "./legacy-binding-plan";
import type { LegacyBindingCapture } from "./legacy-bindings";

test("exhaustive two-record witness graphs require uniqueness in both directions and are order independent", () => {
  const sets = [
    ["terminal-a"],
    ["terminal-b"],
    ["terminal-a", "terminal-b"],
    ["terminal-c"],
  ];
  for (const policy of ["appearance", "tab-colour"] as const) {
    const input = (native_id: string, terminals: string[]) => ({
      adapter: "synthetic",
      instance: "studio",
      kind: "tab" as const,
      native_id,
      policy,
      slot: policy,
      evidence: { terminals },
    });
    for (const a of sets)
      for (const b of sets)
        for (const c of sets)
          for (const d of sets) {
            const old: LegacyBindingRow[] = [a, b].map((terminals, index) => ({
              key: `old-${index}`,
              ended: 0,
              binding: {
                ...input(`old-${index}`, terminals),
                id: `binding-${index}`,
                record_id: `record-${index}`,
                revision: 0,
                state: "unresolved",
                checked_at: null,
              },
            }));
            const current: LegacyBindingCapture[] = [c, d].map(
              (terminals, index) => ({
                key: `new-${index}`,
                input: input(`new-${index}`, terminals),
              }),
            );
            // The requirement's bipartite graph: one edge means intersecting terminal evidence.
            const matrix = [a, b].map((from) =>
              [c, d].map((to) =>
                from.some((terminal) => to.includes(terminal)),
              ),
            );
            for (const oldOrder of [old, [...old].reverse()])
              for (const currentOrder of [current, [...current].reverse()]) {
                const plan = planLegacyBindings(oldOrder, currentOrder);
                for (const [target, capture] of current.entries()) {
                  const sources = [0, 1].filter(
                    (source) => matrix[source]![target],
                  );
                  const expected =
                    sources.length === 1 &&
                    matrix[sources[0]!]!.filter(Boolean).length === 1
                      ? old[sources[0]!]
                      : undefined;
                  expect(plan.get(capture.key)?.binding.id).toBe(
                    expected?.binding.id,
                  );
                }
                expect(
                  new Set([...plan.values()].map((row) => row.binding.id)).size,
                ).toBe(plan.size);
              }
          }
  }
});
