import { describe, expect, test } from "bun:test";
import {
  applyTerminalWindowArrangement,
  createTerminalWindowArrangementState,
  restoreTerminalWindowArrangement,
  retainTerminalWindowArrangementWindows,
  terminalWindowArrangementForLease,
  terminalWindowArrangementPlacements,
  updateTerminalWindowArrangementGeometry,
  type TerminalWindowArrangementParticipant,
} from "./terminalWindowArrangementState";

type Presentation = { kind: "single" | "floating" | "inline"; leaf?: string };
type Window = TerminalWindowArrangementParticipant<Presentation>;

const stage = { left: 10, top: 50, width: 1000, height: 800 };
const first: Window = {
  id: "one",
  minWidth: 420,
  minHeight: 280,
  geometry: { left: 40, top: 100, width: 500, height: 400 },
  presentation: { kind: "inline", leaf: "leaf-one" },
};
const second: Window = {
  id: "two",
  minWidth: 420,
  minHeight: 280,
  geometry: { left: 150, top: 140, width: 500, height: 400 },
  presentation: { kind: "floating" },
};
const later: Window = {
  id: "later",
  minWidth: 420,
  minHeight: 280,
  geometry: { left: 250, top: 180, width: 500, height: 400 },
  presentation: { kind: "floating" },
};

function apply(
  state: ReturnType<typeof createTerminalWindowArrangementState<Presentation>>,
  preset: "single" | "columns" | "rows" | "grid" | "cascade",
  windows: Window[] = [first, second],
  scopeKey = "visual",
) {
  return applyTerminalWindowArrangement(state, {
    leaseKey: "connection:generation-1",
    scopeKey,
    preset,
    stage,
    windows,
    activeId: windows[windows.length - 1]?.id ?? null,
  });
}

describe("terminal window arrangement state", () => {
  test("captures first presentation and geometry across repeated presets", () => {
    const empty = createTerminalWindowArrangementState<Presentation>(
      "connection:generation-1",
    );
    const firstResult = apply(empty, "columns");
    expect(firstResult.result.available).toBe(true);
    const moved = [
      { ...first, geometry: { left: 400, top: 350, width: 450, height: 350 } },
      second,
      later,
    ];
    const secondResult = apply(firstResult.state, "cascade", moved);
    const restored = restoreTerminalWindowArrangement(secondResult.state, {
      leaseKey: "connection:generation-1",
      scopeKey: "visual",
      openIds: ["one", "two", "later"],
    });
    expect(restored.targets).toEqual([
      {
        id: "one",
        baseline: {
          geometry: first.geometry ?? null,
          presentation: first.presentation,
        },
      },
      {
        id: "two",
        baseline: {
          geometry: second.geometry ?? null,
          presentation: second.presentation,
        },
      },
      {
        id: "later",
        baseline: {
          geometry: later.geometry ?? null,
          presentation: later.presentation,
        },
      },
    ]);
    expect(restored.preset).toBeNull();
    expect(restored.state.scopes.visual).toBeUndefined();
    expect(empty.scopes).toEqual({});
  });

  test("multiwindow placement is one-shot and excludes later opens", () => {
    const empty = createTerminalWindowArrangementState<Presentation>(
      "connection:generation-1",
    );
    const arranged = apply(empty, "columns").state;
    const before = terminalWindowArrangementPlacements(arranged, {
      leaseKey: "connection:generation-1",
      scopeKey: "visual",
      stage,
      windows: [first, second],
      activeId: "two",
    });
    const after = terminalWindowArrangementPlacements(arranged, {
      leaseKey: "connection:generation-1",
      scopeKey: "visual",
      stage,
      windows: [first, second, later],
      activeId: "later",
    });
    expect(after).toEqual(before);
    expect(after?.map(({ id }) => id)).toEqual(["one", "two"]);
    const restored = restoreTerminalWindowArrangement(arranged, {
      leaseKey: "connection:generation-1",
      scopeKey: "visual",
      openIds: ["one", "two", "later"],
    });
    expect(restored.targets.map(({ id }) => id)).toEqual(["one", "two"]);
  });

  test("Single follows a newly active window without adding it to Restore", () => {
    const empty = createTerminalWindowArrangementState<Presentation>(
      "connection:generation-1",
    );
    const single = apply(empty, "single").state;
    expect(
      terminalWindowArrangementPlacements(single, {
        leaseKey: "connection:generation-1",
        scopeKey: "visual",
        stage,
        windows: [first, second, later],
        activeId: "later",
      }),
    ).toEqual([{ id: "later", geometry: stage }]);
    const restored = restoreTerminalWindowArrangement(single, {
      leaseKey: "connection:generation-1",
      scopeKey: "visual",
      openIds: ["one", "two", "later"],
    });
    expect(restored.targets.map(({ id }) => id)).toEqual(["one", "two"]);
  });

  test("Restore excludes closed windows and cannot revive a reused ID after retention", () => {
    const empty = createTerminalWindowArrangementState<Presentation>(
      "connection:generation-1",
    );
    const arranged = apply(empty, "columns").state;
    const retained = retainTerminalWindowArrangementWindows(arranged, {
      leaseKey: "connection:generation-1",
      scopeKey: "visual",
      openIds: ["one"],
    });
    const restored = restoreTerminalWindowArrangement(retained, {
      leaseKey: "connection:generation-1",
      scopeKey: "visual",
      openIds: ["one", "two"],
    });
    expect(restored.targets.map(({ id }) => id)).toEqual(["one"]);
  });

  test("separate scopes retain placement while inactive and a lease change retires both", () => {
    const empty = createTerminalWindowArrangementState<Presentation>(
      "connection:generation-1",
    );
    const visual = updateTerminalWindowArrangementGeometry(
      apply(empty, "columns").state,
      {
        leaseKey: "connection:generation-1",
        scopeKey: "visual",
        id: "one",
        geometry: { left: 80, top: 120, width: 470, height: 390 },
      },
    );
    const spaces = apply(visual, "rows", [first, second], "spaces:workspace-1");
    expect(spaces.state.scopes.visual?.placements).toEqual(
      visual.scopes.visual?.placements,
    );
    expect(spaces.state.scopes["spaces:workspace-1"]?.preset).toBe("rows");
    expect(spaces.state.scopes.visual?.placements[0]?.geometry).toEqual({
      left: 80,
      top: 120,
      width: 470,
      height: 390,
    });
    const restoredVisual = restoreTerminalWindowArrangement(spaces.state, {
      leaseKey: "connection:generation-1",
      scopeKey: "visual",
      openIds: ["one", "two"],
    });
    expect(restoredVisual.targets[0]?.baseline.geometry).toEqual(
      first.geometry ?? null,
    );
    const retired = terminalWindowArrangementForLease(
      spaces.state,
      "connection:generation-2",
    );
    expect(retired.scopes).toEqual({});
    expect(
      terminalWindowArrangementPlacements(spaces.state, {
        leaseKey: "connection:generation-2",
        scopeKey: "visual",
        stage,
        windows: [first, second],
        activeId: "two",
      }),
    ).toBeNull();
  });

  test("Restore returns the original Spaces Single mode", () => {
    const empty = createTerminalWindowArrangementState<Presentation>(
      "connection:generation-1",
    );
    const arranged = applyTerminalWindowArrangement(empty, {
      leaseKey: "connection:generation-1",
      scopeKey: "spaces:workspace-1",
      preset: "grid",
      initialPreset: "single",
      stage,
      windows: [first, second],
      activeId: "two",
    }).state;
    const restored = restoreTerminalWindowArrangement(arranged, {
      leaseKey: "connection:generation-1",
      scopeKey: "spaces:workspace-1",
      openIds: ["one", "two"],
    });
    expect(restored.preset).toBe("single");
    expect(restored.state.scopes["spaces:workspace-1"]?.preset).toBe("single");
    expect(
      terminalWindowArrangementPlacements(restored.state, {
        leaseKey: "connection:generation-1",
        scopeKey: "spaces:workspace-1",
        stage,
        windows: [first, second],
        activeId: "one",
      }),
    ).toEqual([{ id: "one", geometry: stage }]);
  });

  test("an unavailable command leaves snapshots and geometry unchanged", () => {
    const empty = createTerminalWindowArrangementState<Presentation>(
      "connection:generation-1",
    );
    const arranged = apply(empty, "columns").state;
    const failed = apply(arranged, "rows", [first, second, later]);
    expect(failed.result.available).toBe(false);
    expect(failed.state).toBe(arranged);
  });

  test("compact presentation does not overwrite desktop placement", () => {
    const empty = createTerminalWindowArrangementState<Presentation>(
      "connection:generation-1",
    );
    const arranged = apply(empty, "columns").state;
    const desktop = arranged.scopes.visual?.placements;
    const compactStage = { left: 0, top: 40, width: 390, height: 700 };
    const compact = terminalWindowArrangementPlacements(arranged, {
      leaseKey: "connection:generation-1",
      scopeKey: "visual",
      stage: compactStage,
      windows: [
        { ...first, minWidth: 320 },
        { ...second, minWidth: 320 },
      ],
      activeId: "two",
      compact: true,
    });
    expect(compact).toEqual([{ id: "two", geometry: compactStage }]);
    expect(arranged.scopes.visual?.placements).toBe(desktop);
  });
});
