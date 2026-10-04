import { describe, expect, test } from "bun:test";
import {
  createWindowManager,
  reconcileWindows,
  reduceWindowManager,
  windowGeometry,
  visibleWindowIds,
  windowCanvas,
  windowDividers,
} from "./windowManager";

const stage = { width: 1200, height: 800 };
const inputs = ["a", "b"].map((id) => ({ id, label: id }));
const initial = () => reconcileWindows(createWindowManager(), inputs, stage);
const command = (
  state: ReturnType<typeof initial>,
  action: Parameters<typeof reduceWindowManager>[1],
) => reduceWindowManager(state, action, stage);

describe("coordinated windows", () => {
  test("focus and later admission never move an existing snapped window", () => {
    let state = command(initial(), { type: "snap", id: "a", target: "left" });
    const before = windowGeometry(state, "a", stage);
    state = reconcileWindows(
      state,
      [...inputs, { id: "c", label: "c" }],
      stage,
    );
    state = command(state, { type: "focus", id: "a" });
    state = command(state, { type: "snap", id: "b", target: "left" });
    expect(windowGeometry(state, "a", stage)).toEqual(before);
    expect(windowGeometry(state, "b", stage)).toEqual(before);
    expect(state.order).toEqual(["a", "b", "c"]);
    expect(state.stack[state.stack.length - 1]).toBe("b");
  });
  test("maximize and minimize preserve the exact normal placement", () => {
    let state = command(initial(), { type: "arrange", preset: "columns" });
    const before = windowGeometry(state, "a", stage);
    state = command(state, { type: "maximize", id: "a" });
    state = command(state, { type: "minimize", id: "a" });
    expect(visibleWindowIds(state, false)).not.toContain("a");
    state = command(state, { type: "focus", id: "a" });
    expect(windowGeometry(state, "a", stage)).toEqual({
      left: 0,
      top: 0,
      ...stage,
    });
    state = command(state, { type: "maximize", id: "a" });
    expect(windowGeometry(state, "a", stage)).toEqual(before);
  });
  test("an arranged pair shares a divider without changing admission order", () => {
    let state = command(initial(), { type: "arrange", preset: "columns" });
    const divider = windowDividers(state, stage)[0]!;
    expect(divider.axis).toBe("x");
    state = command(state, { type: "divide", divider, delta: 100 });
    const a = windowGeometry(state, "a", stage)!;
    const b = windowGeometry(state, "b", stage)!;
    expect(a.width).toBeGreaterThan(b.width);
    expect(b.left - (a.left + a.width)).toBeCloseTo(8);
    expect(state.order).toEqual(["a", "b"]);
  });
  test("dividers and usable tile minima survive viewport changes", () => {
    let state = command(initial(), { type: "arrange", preset: "columns" });
    expect(windowDividers(state, { width: 800, height: 600 })).toHaveLength(1);
    state = command(state, {
      type: "divide",
      divider: windowDividers(state, stage)[0]!,
      delta: -376,
    });
    const smaller = { width: 800, height: 600 };
    expect(windowGeometry(state, "a", smaller)!.width).toBeGreaterThanOrEqual(
      220,
    );
    expect(windowDividers(state, smaller)).toHaveLength(1);
  });
  test("restoring an arrangement does not reopen closed or move later windows", () => {
    let state = initial();
    const original = windowGeometry(state, "a", stage);
    state = command(state, { type: "arrange", preset: "grid" });
    state = reconcileWindows(
      state,
      [...inputs, { id: "c", label: "c" }],
      stage,
    );
    const later = windowGeometry(state, "c", stage);
    state = command(state, { type: "dismiss", id: "b" });
    state = command(state, { type: "restore-layout" });
    expect(windowGeometry(state, "a", stage)).toEqual(original);
    expect(windowGeometry(state, "c", stage)).toEqual(later);
    expect(visibleWindowIds(state, false)).not.toContain("b");
  });
  test("restore only affects arrangement participants and Open all restores minimized windows", () => {
    let state = reconcileWindows(
      initial(),
      [...inputs, { id: "c", label: "c" }],
      stage,
    );
    state = command(state, { type: "minimize", id: "c" });
    state = command(state, { type: "arrange", preset: "columns" });
    expect(state.baseline?.windows.c).toBeUndefined();
    state = command(state, {
      type: "place",
      id: "c",
      rect: { left: 50, top: 50, width: 300, height: 200 },
    });
    state = command(state, { type: "restore-layout" });
    expect(windowGeometry(state, "c", stage)).toEqual({
      left: 50,
      top: 50,
      width: 300,
      height: 200,
    });
    state = command(state, { type: "minimize", id: "c" });
    state = command(state, {
      type: "arrange",
      preset: "grid",
      includeMinimized: true,
    });
    expect(state.windows.c?.minimized).toBe(false);
  });
  test("compact projection never writes over desktop geometry", () => {
    const state = command(initial(), { type: "arrange", preset: "grid" });
    const snapshot = structuredClone(state);
    expect(visibleWindowIds(state, true)).toHaveLength(1);
    windowGeometry(state, state.activeId!, { width: 320, height: 380 }, true);
    expect(state).toEqual(snapshot);
    expect(windowGeometry(state, "a", stage)).toEqual(
      windowGeometry(snapshot, "a", stage),
    );
  });
  test("dismissal survives topology reconciliation and explicit selection restores", () => {
    let state = command(initial(), { type: "dismiss", id: "a" });
    state = reconcileWindows(state, inputs, stage);
    expect(visibleWindowIds(state, false)).not.toContain("a");
    state = command(state, { type: "focus", id: "a" });
    expect(visibleWindowIds(state, false)).toContain("a");
  });
  test("retiring one identity cannot retire another host or resurrect old state", () => {
    const state = command(initial(), { type: "arrange", preset: "columns" });
    const retained = reconcileWindows(state, [{ id: "b", label: "b" }], stage);
    expect(retained.order).toEqual(["b"]);
    expect(retained.windows.a).toBeUndefined();
    const reopened = reconcileWindows(retained, inputs, stage);
    expect(reopened.windows.a?.placement.kind).toBe("floating");
  });
  test("large arrangements retain usable tiles and expose a scrollable canvas", () => {
    let state = reconcileWindows(
      createWindowManager(),
      Array.from({ length: 16 }, (_, i) => ({
        id: String(i),
        label: String(i),
      })),
      stage,
    );
    state = command(state, { type: "arrange", preset: "grid" });
    const small = { width: 800, height: 400 };
    const canvas = windowCanvas(state, small);
    for (const id of state.order) {
      const geometry = windowGeometry(state, id, small)!;
      expect(geometry.width).toBeGreaterThanOrEqual(219);
      expect(geometry.height).toBeGreaterThanOrEqual(159);
    }
    expect(canvas.height).toBeGreaterThan(small.height);
  });
});
