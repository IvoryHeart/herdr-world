import { expect, test } from "bun:test";
import type { WorldObjectNode } from "./worldObject";
import { worldSwitchTargets } from "./worldSwitchTargets";

const leaf = (
  id: string,
  kind: "agent" | "terminal" | "space",
  status: string,
  extra: Partial<{ actionable: boolean; stale: boolean }> = {},
) =>
  ({
    id,
    kind,
    label: id,
    status,
    stateLabels: { blocked: "Needs you", done: "Done", working: "Working" },
    spaceLabel: "room",
    actionable: true,
    stale: false,
    ...extra,
  }) as unknown as WorldObjectNode;

test("a window's switch list holds live agents and terminals, those that need you first", () => {
  const chosen: string[] = [];
  const targets = worldSwitchTargets(
    [
      leaf("current", "agent", "blocked"),
      leaf("busy", "agent", "working"),
      leaf("shell", "terminal", "done"),
      leaf("asks", "agent", "blocked"),
      leaf("gone", "agent", "blocked", { stale: true }),
      leaf("viewer", "terminal", "blocked", { actionable: false }),
      leaf("room", "space", "blocked"),
    ],
    "current",
    (node) => chosen.push(node.id),
  );
  expect(targets.map((t) => [t.id, t.detail])).toEqual([
    ["asks", "Needs you · room"],
    ["shell", "Done · room"],
    ["busy", "Working · room"],
  ]);
  targets[1]!.onSelect();
  expect(chosen).toEqual(["shell"]);
});
