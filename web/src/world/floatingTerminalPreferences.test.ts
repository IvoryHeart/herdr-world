import { describe, expect, test } from "bun:test";
import {
  FLOATING_TERMINAL_DOCK_KEY,
  FLOATING_TERMINAL_GEOMETRY_KEY,
  floatingTerminalGeometryId,
  readFloatingTerminalDock,
  readFloatingTerminalGeometry,
  writeFloatingTerminalDock,
  writeFloatingTerminalGeometry,
} from "./floatingTerminalPreferences";

describe("floating terminal preferences", () => {
  test("restores geometry while keeping its desktop title region reachable", () => {
    const storage = memoryStorage(
      JSON.stringify([
        {
          id: '["host-a","terminal-a"]',
          geometry: { left: 900, top: 700, width: 700, height: 500 },
        },
      ]),
    );

    expect(
      readFloatingTerminalGeometry(
        storage,
        '["host-a","terminal-a"]',
        { left: 20, top: 20, width: 420, height: 280 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ left: 92, top: 536, width: 700, height: 500 });
  });

  test("rejects malformed values and writes a bounded normalized record", () => {
    const storage = memoryStorage(
      JSON.stringify([
        {
          id: "bad",
          geometry: { left: Number.NaN, top: 0, width: 1, height: 1 },
        },
      ]),
    );
    const fallback = { left: 8, top: 8, width: 420, height: 280 };

    expect(
      readFloatingTerminalGeometry(storage, "bad", fallback, {
        width: 800,
        height: 600,
      }),
    ).toEqual(fallback);
    writeFloatingTerminalGeometry(storage, "good", fallback);
    expect(storage.written).toEqual({
      key: FLOATING_TERMINAL_GEOMETRY_KEY,
      value: JSON.stringify([{ id: "good", geometry: fallback }]),
    });
  });

  test("uses connection and terminal identity without binding layout to a generation", () => {
    expect(
      floatingTerminalGeometryId({
        connectionId: "host-a",
        terminalId: "terminal-a",
      }),
    ).toBe('["host-a","terminal-a"]');
  });

  test("migrates pane geometry once and keeps the latest tab position after reconnect", () => {
    const legacyId = '["host-a","pane-node-a"]';
    const stableId = floatingTerminalGeometryId({
      connectionId: "host-a",
      workspaceId: "workspace-a",
      tabId: "tab-a",
      nodeId: "pane-node-a",
    });
    const oldPosition = { left: 24, top: 40, width: 420, height: 300 };
    const latestPosition = { left: 280, top: 100, width: 500, height: 360 };
    const viewport = { width: 1200, height: 800 };
    const storage = memoryStorage(
      JSON.stringify([{ id: legacyId, geometry: oldPosition }]),
    );

    expect(
      readFloatingTerminalGeometry(
        storage,
        stableId,
        latestPosition,
        viewport,
        legacyId,
      ),
    ).toEqual(oldPosition);
    expect(JSON.parse(storage.written!.value)).toContainEqual({
      id: stableId,
      geometry: oldPosition,
    });

    writeFloatingTerminalGeometry(storage, stableId, latestPosition);
    expect(
      readFloatingTerminalGeometry(
        storage,
        stableId,
        oldPosition,
        viewport,
        legacyId,
      ),
    ).toEqual(latestPosition);
    expect(
      floatingTerminalGeometryId({
        connectionId: "host-a",
        workspaceId: "workspace-a",
        tabId: "tab-a",
        nodeId: "pane-node-b",
      }),
    ).toBe(stableId);
  });
});

function memoryStorage(initial: string | null) {
  const storage = {
    written: null as { key: string; value: string } | null,
    getItem: () => storage.written?.value ?? initial,
    setItem(key: string, value: string) {
      storage.written = { key, value };
    },
  };
  return storage;
}

describe("window docks", () => {
  test("keep the last dock per window and ignore unknown values", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    expect(readFloatingTerminalDock(storage, "a")).toBeNull();
    writeFloatingTerminalDock(storage, "a", "right");
    writeFloatingTerminalDock(storage, "b", "float");
    writeFloatingTerminalDock(storage, "a", "float");
    expect(readFloatingTerminalDock(storage, "a")).toBe("float");
    expect(readFloatingTerminalDock(storage, "b")).toBe("float");
    store.set(
      FLOATING_TERMINAL_DOCK_KEY,
      JSON.stringify([
        { id: "c", dock: "sideways" },
        { id: "d", dock: "left" },
      ]),
    );
    expect(readFloatingTerminalDock(storage, "c")).toBeNull();
    expect(readFloatingTerminalDock(storage, "d")).toBe("left");
  });
});
