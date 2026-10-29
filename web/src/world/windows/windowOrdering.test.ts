import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import {
  createWindowManager,
  reconcileWindows,
  reduceWindowManager,
  visibleWindowIds,
  windowGeometry,
  type WindowCommand,
  type WindowManagerState,
} from "./windowManager";

const size = { width: 1200, height: 800 };
const ids = ["synthetic-a", "synthetic-b"];
type Step = WindowCommand | { type: "topology"; mask: number };
const steps: Step[] = [
  ...ids.flatMap(
    (id) =>
      ["focus", "raise", "minimize", "dismiss", "maximize"].map((type) => ({
        type,
        id,
      })) as WindowCommand[],
  ),
  ...ids.flatMap((id) =>
    (["fit-left", "fit-right"] as const).map((target) => ({
      type: "snap" as const,
      id,
      target,
    })),
  ),
  ...["columns", "grid", "single", "cascade"].map(
    (preset) => ({ type: "arrange", preset }) as WindowCommand,
  ),
  { type: "arrange", preset: "grid", includeMinimized: true },
  { type: "restore-layout" },
  { type: "dismiss-all" },
  ...[0, 1, 2, 3].map((mask) => ({ type: "topology", mask }) as const),
];
function transition(before: WindowManagerState, step: Step) {
  return step.type === "topology"
    ? reconcileWindows(
        before,
        ids
          .filter((_, i) => step.mask & (1 << i))
          .map((id) => ({ id, label: id })),
        size,
      )
    : reduceWindowManager(before, step, size);
}
function check(
  before: WindowManagerState,
  after: WindowManagerState,
  step: Step,
) {
  const members = Object.keys(after.windows).sort();
  assert.deepEqual(
    [...after.order].sort(),
    members,
    "admission order membership",
  );
  assert.deepEqual([...after.stack].sort(), members, "focus stack membership");
  assert.equal(
    new Set(after.order).size,
    after.order.length,
    "unique admission",
  );
  assert.equal(
    new Set(after.stack).size,
    after.stack.length,
    "unique focus ownership",
  );
  assert(
    after.activeId === null || members.includes(after.activeId),
    "active owner exists",
  );
  assert(
    after.revealVersion >= before.revealVersion,
    "reveal counter monotonic",
  );
  for (const compact of [false, true])
    for (const id of visibleWindowIds(after, compact)) {
      assert(
        !after.windows[id]!.dismissed && !after.windows[id]!.minimized,
        "hidden owner not visible",
      );
      const geometry = windowGeometry(after, id, size)!;
      assert(
        Object.values(geometry).every(Number.isFinite) &&
          geometry.width > 0 &&
          geometry.height > 0,
        "usable visible geometry",
      );
    }
  if (step.type === "topology") {
    assert.deepEqual(
      members,
      ids.filter((_, i) => step.mask & (1 << i)),
      "exact live catalogue",
    );
    for (const id of Object.keys(after.baseline?.windows ?? {}))
      assert(members.includes(id), "removed owner excluded from restore");
  } else if ("id" in step && before.windows[step.id]) {
    const previous = before.windows[step.id]!;
    if (
      step.type === "focus" ||
      step.type === "maximize" ||
      step.type === "snap"
    ) {
      assert.equal(after.activeId, step.id, "explicit focus owner");
      assert.equal(
        after.stack[after.stack.length - 1],
        step.id,
        "explicit focus stack",
      );
      assert(
        !after.windows[step.id]!.dismissed &&
          !after.windows[step.id]!.minimized,
        "explicit focus reveals owner",
      );
    }
    if (step.type === "raise" && (previous.dismissed || previous.minimized))
      assert.equal(after, before, "raise cannot reopen hidden owner");
    if (step.type === "minimize" || step.type === "dismiss")
      assert(
        !visibleWindowIds(after, false).includes(step.id),
        "explicit hide owner",
      );
    for (const id of members.filter((id) => id !== step.id)) {
      assert.equal(
        after.windows[id]!.dismissed,
        before.windows[id]!.dismissed,
        "peer dismissal isolation",
      );
      assert.equal(
        after.windows[id]!.minimized,
        before.windows[id]!.minimized,
        "peer minimization isolation",
      );
    }
    if (step.type === "snap") {
      assert.deepEqual(
        windowGeometry(after, step.id, size),
        {
          left: step.target === "fit-right" ? size.width - 760 : 0,
          top: 0,
          width: 760,
          height: 520,
        },
        "fit snap uses default size and the selected edge",
      );
    } else
      assert.deepEqual(
        after.windows[step.id]!.placement,
        previous.placement,
        "focus/hide/maximize preserves normal placement",
      );
  } else if (step.type === "restore-layout") {
    for (const id of members) {
      assert.equal(
        after.windows[id]!.dismissed,
        before.windows[id]!.dismissed,
        "restore does not reopen closed owners",
      );
      assert.equal(
        after.windows[id]!.minimized,
        before.windows[id]!.minimized,
        "restore preserves minimization",
      );
      if (!before.baseline?.windows[id] || before.windows[id]!.dismissed)
        assert.deepEqual(
          after.windows[id]!.placement,
          before.windows[id]!.placement,
          "restore only touches participating live owners",
        );
    }
  }
}
function explore(subject = transition) {
  let frontier = [createWindowManager()];
  const seen = new Set([JSON.stringify(frontier[0])]);
  let transitions = 0;
  for (let depth = 0; depth < 5; depth++) {
    const next: WindowManagerState[] = [];
    for (const before of frontier)
      for (const step of steps) {
        const after = subject(before, step);
        check(before, after, step);
        transitions++;
        // The revision is an observable counter, checked above, not a transition choice.
        const key = JSON.stringify({ ...after, revealVersion: 0 });
        if (!seen.has(key)) {
          seen.add(key);
          next.push(after);
        }
      }
    frontier = next;
  }
  return { states: seen.size, transitions };
}
test("all bounded two-owner window command orderings retain visibility, ownership and restore contracts", () => {
  const result = explore();
  console.info(
    `Window bounded exploration: ${result.states} states, ${result.transitions} transitions, depth 5, ${steps.length} commands`,
  );
  expect(result.states).toBeGreaterThan(100);
  expect(result.transitions).toBeGreaterThan(1000);
});
test("window ordering oracle rejects a hide command that changes another owner", () => {
  expect(() =>
    explore((before, step) => {
      const after = transition(before, step);
      if (
        step.type === "dismiss" &&
        step.id === ids[1] &&
        after.windows[ids[0]!]
      )
        return {
          ...after,
          windows: {
            ...after.windows,
            [ids[0]!]: {
              ...after.windows[ids[0]!]!,
              dismissed: !after.windows[ids[0]!]!.dismissed,
            },
          },
        };
      return after;
    }),
  ).toThrow("peer dismissal isolation");
});
