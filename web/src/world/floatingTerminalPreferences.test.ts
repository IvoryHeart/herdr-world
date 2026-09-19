import { describe, expect, test } from "bun:test";
import {
  FLOATING_TERMINAL_GEOMETRY_KEY,
  floatingTerminalGeometryId,
  readFloatingTerminalGeometry,
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
