import { expect, test } from "bun:test";
import { outOfFuelParam, pickOutOfFuelTrial } from "./townOutOfFuelTrial";
import type { WorldLeafObject } from "../worldObject";

const MIN = 60_000;

test("the out-of-fuel switch reads minutes until the reset", () => {
  expect(outOfFuelParam("?outOfFuel")).toBe(3 * MIN);
  expect(outOfFuelParam("?outOfFuel=")).toBe(3 * MIN);
  expect(outOfFuelParam("?outOfFuel=5")).toBe(5 * MIN);
  expect(outOfFuelParam("?outOfFuel=1h")).toBe(60 * MIN);
  expect(outOfFuelParam("?outOfFuel=0")).toBeNull();
  expect(outOfFuelParam("?outOfFuel=soon")).toBeNull();
  expect(outOfFuelParam("?awaySince=5")).toBeNull();
});

// Synthetic leaves only.
const leaf = (
  id: string,
  agent: string,
  status: WorldLeafObject["status"] = "idle",
  extra: Partial<WorldLeafObject> = {},
) =>
  ({
    id,
    kind: "agent",
    stale: false,
    status,
    pane: { pane_id: `p-${id}`, terminal_id: `t-${id}`, agent },
    ...extra,
  }) as WorldLeafObject;

test("the switch stops one quiet Claude and one quiet Codex agent", () => {
  const trial = pickOutOfFuelTrial(
    [
      leaf("busy-claude", "claude", "working"),
      leaf("claude", "claude"),
      leaf("codex", "codex", "blocked"),
      leaf("other-codex", "codex"),
      leaf("shell", "", "idle", { kind: "terminal" }),
    ],
    1_000,
    3 * MIN,
  );
  expect([...trial.byLeaf]).toEqual([
    ["claude", { harness: "claude", at: 1_000, resets_at: 1_000 + 3 * MIN }],
    ["codex", { harness: "codex", at: 1_000, resets_at: 1_000 + 3 * MIN }],
  ]);
  expect(trial.byPane.get("p-codex\u0000t-codex")?.harness).toBe("codex");
});

test("another agent stands in for a missing harness, and none means no trial", () => {
  const trial = pickOutOfFuelTrial(
    [leaf("a", "claude"), leaf("b", "claude")],
    0,
    MIN,
  );
  expect([...trial.byLeaf].map(([id, stop]) => [id, stop.harness])).toEqual([
    ["a", "claude"],
    ["b", "codex"],
  ]);
  expect(
    pickOutOfFuelTrial([leaf("s", "claude", "idle", { stale: true })], 0, MIN)
      .byLeaf.size,
  ).toBe(0);
});
