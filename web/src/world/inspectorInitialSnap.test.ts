import { expect, test } from "bun:test";
import { inspectorInitialSnap } from "./useWorldInspectorWindows";

test("Town's Inspector docks right unless floated, and keeps where it was left", () => {
  expect(inspectorInitialSnap("town", "docked", null)).toBe("right");
  expect(inspectorInitialSnap("town", "floating", null)).toBeUndefined();
  expect(inspectorInitialSnap("town", "docked", "float")).toBeUndefined();
  expect(inspectorInitialSnap("town", "floating", "left")).toBe("left");
  expect(inspectorInitialSnap("desk", "floating", "float")).toBe("right");
  expect(inspectorInitialSnap("board", "docked", "right")).toBeUndefined();
});
