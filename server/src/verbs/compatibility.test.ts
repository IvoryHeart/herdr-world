import { expect, test } from "bun:test";
import baseline from "./legacy-outcomes.json";
import { legacyOutcomes } from "./legacy-fixture";

test("P4: every existing CLI command keeps its pre-registry outcome for both actors", async () => {
  expect(await legacyOutcomes()).toEqual(baseline);
});
