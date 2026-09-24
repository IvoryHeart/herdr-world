import { describe, expect, test } from "bun:test";
import {
  parseGraphPreferences,
  readGraphPreferences,
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
      collapsedIds: [],
      positions: {},
    });
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
