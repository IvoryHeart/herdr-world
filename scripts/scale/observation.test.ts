import { expect, test } from "bun:test";
import { observationCase } from "./observation";
import { shapes } from "./fixture";

test("scale observations keep repeated native IDs qualified and retired generations non-actionable", async () => {
  const result = await observationCase(shapes[0]!);
  const fresh = result.phases[0]!;
  expect(fresh.counts.actionable).toBe(3);
  expect(fresh.counts.identities.map((i) => i.connection)).toEqual([
    "source-0",
    "source-1",
    "source-2",
  ]);
  expect(result.phases[1]!.nativeListCalls).toBe(0);
  const retired = result.phases[3]!.counts.identities[0]!;
  expect(retired).toMatchObject({
    generation: 8,
    snapshotGeneration: 7,
    stale: true,
    actionable: false,
  });
  expect(result.phases[3]!.counts.actionable).toBe(2);
});
