import { describe, expect, test } from "bun:test";
import {
  parseGraphPreferences,
  readGraphPreferences,
  rotateGraph,
  writeGraphPreferences,
} from "./graphPreferences";

describe("Graph preferences", () => {
  test("validates camera, disclosure, and bounded pinned coordinates", () => {
    expect(
      parseGraphPreferences({
        camera: { x: 24, y: -7, zoom: 2 },
        cameraMode: "manual",
        collapsedIds: ["host", "host", 2],
        positions: {
          agent: { x: 40, y: -30, pinned: true },
          invalid: { x: Number.POSITIVE_INFINITY, y: 0, pinned: true },
        },
      }),
    ).toEqual({
      camera: { x: 24, y: -7, zoom: 2 },
      cameraMode: "manual",
      rotation: 0,
      collapsedIds: ["host"],
      positions: { agent: { x: 40, y: -30, pinned: true } },
    });
  });

  test("fails to defaults and persists only admitted values", () => {
    const storage = memoryStorage("{");
    expect(readGraphPreferences(storage).prefs.cameraMode).toBe("fit");
    writeGraphPreferences(storage, parseGraphPreferences({}));
    expect(JSON.parse(storage.written ?? "")).toEqual({
      camera: { x: 0, y: 0, zoom: 1 },
      cameraMode: "fit",
      rotation: 0,
      collapsedIds: [],
      positions: {},
    });
  });

  test("validates and preserves a saved rotation", () => {
    expect(parseGraphPreferences({ rotation: 90 }).rotation).toBe(90);
    expect(parseGraphPreferences({ rotation: 45 }).rotation).toBe(0);
    expect(parseGraphPreferences({ rotation: 270 }).rotation).toBe(270);
  });

  test("rotateGraph cycles through quarter turns", () => {
    expect(rotateGraph(0, "right")).toBe(90);
    expect(rotateGraph(90, "right")).toBe(180);
    expect(rotateGraph(180, "right")).toBe(270);
    expect(rotateGraph(270, "right")).toBe(0);
    expect(rotateGraph(0, "left")).toBe(270);
    expect(rotateGraph(270, "left")).toBe(180);
    expect(rotateGraph(180, "left")).toBe(90);
    expect(rotateGraph(90, "left")).toBe(0);
  });
});

function memoryStorage(initial: string | null) {
  const storage = {
    written: null as string | null,
    getItem: () => initial,
    setItem(_key: string, value: string) {
      storage.written = value;
    },
  };
  return storage;
}
