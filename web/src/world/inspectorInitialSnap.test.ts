import { expect, test } from "bun:test";
import {
  inspectorInitialDock,
  inspectorInitialSnap,
  TOWN_DOCK_WIDTH,
} from "./useWorldInspectorWindows";

test("Town's Inspector docks right unless floated, and keeps where it was left", () => {
  expect(inspectorInitialSnap("town", "docked", null)).toBe("right");
  expect(inspectorInitialSnap("town", "floating", null)).toBeUndefined();
  expect(inspectorInitialSnap("town", "docked", "float")).toBeUndefined();
  expect(inspectorInitialSnap("town", "floating", "left")).toBe("left");
  expect(inspectorInitialSnap("desk", "floating", "float")).toBe("right");
  expect(inspectorInitialSnap("board", "docked", "right")).toBeUndefined();
});

test("Town's dock opens readable, then at the width it was resized to", () => {
  expect(inspectorInitialDock("town", null, null)).toEqual({
    width: TOWN_DOCK_WIDTH,
    upToHalf: true,
  });
  expect(inspectorInitialDock("town", "right", 640)).toEqual({ width: 640 });
  // "Right half" from the window menu keeps half.
  expect(inspectorInitialDock("town", "right", null)).toBeUndefined();
  expect(inspectorInitialDock("town", "float", 640)).toBeUndefined();
  expect(inspectorInitialDock("desk", null, null)).toBeUndefined();
});
