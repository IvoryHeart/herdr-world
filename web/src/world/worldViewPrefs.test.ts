import { describe, expect, it } from "vitest";
import {
  emptyWorldViewPrefs,
  readWorldViewPrefs,
  WORLD_VIEW_PREFS_STORAGE_KEY,
  writeWorldViewPrefs,
} from "./worldViewPrefs";

function memoryStorage(initial?: string) {
  const values = new Map<string, string>(initial ? [[WORLD_VIEW_PREFS_STORAGE_KEY, initial]] : []);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    read: () => values.get(WORLD_VIEW_PREFS_STORAGE_KEY) ?? null,
  };
}

describe("world view preferences", () => {
  it("round trips bounded layout state without terminal content", () => {
    const storage = memoryStorage();
    writeWorldViewPrefs({
      geometry: { "host-a:pane-a": { left: 12, top: 24, width: 720, height: 420 } },
      themeGeometry: {
        graph: { "host-a:pane-a": { left: 220, top: 180, width: 620, height: 360 } },
      },
      order: ["host-a:pane-a"],
      scrollTop: 360,
    }, storage);

    expect(readWorldViewPrefs(storage)).toEqual({
      geometry: { "host-a:pane-a": { left: 12, top: 24, width: 720, height: 420 } },
      themeGeometry: {
        graph: { "host-a:pane-a": { left: 220, top: 180, width: 620, height: 360 } },
      },
      order: ["host-a:pane-a"],
      scrollTop: 360,
    });
    expect(storage.read()).not.toContain("terminal");
  });

  it("rejects malformed values and bounds saved geometry", () => {
    const storage = memoryStorage(JSON.stringify({
      geometry: {
        good: { left: -10, top: 30, width: 12_000, height: 40 },
        bad: { left: "nope" },
      },
      themeGeometry: {
        graph: { good: { left: -20, top: 60, width: 15_000, height: 80 } },
        "NOT VALID": { ignored: { left: 1, top: 2, width: 3, height: 4 } },
      },
      order: ["good", "good", 12],
      scrollTop: -4,
    }));

    expect(readWorldViewPrefs(storage)).toEqual({
      geometry: { good: { left: 0, top: 30, width: 10_000, height: 40 } },
      themeGeometry: {
        graph: { good: { left: 0, top: 60, width: 10_000, height: 80 } },
      },
      order: ["good"],
      scrollTop: 0,
    });
    expect(emptyWorldViewPrefs()).toEqual({
      geometry: {},
      themeGeometry: {},
      order: [],
      scrollTop: 0,
    });
  });
});
