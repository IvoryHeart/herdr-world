import { describe, expect, test } from "bun:test";
import {
  DEFAULT_OFFICE_PREFERENCES,
  OFFICE_PREFERENCES_KEY,
  readOfficePreferences,
  writeOfficePreferences,
} from "./officePreferences";

describe("Office preferences", () => {
  test("admits only known layout choices and bounded scroll positions", () => {
    const storage = memoryStorage(
      JSON.stringify({
        roomAlignment: "sideways",
        longTitleMode: "compact",
        inspectorPresentation: "stacked",
        scrollLeft: -4,
        scrollTop: 9_000_000,
      }),
    );

    expect(readOfficePreferences(storage)).toEqual({
      roomAlignment: "left",
      longTitleMode: "compact",
      inspectorPresentation: "docked",
      scrollLeft: 0,
      scrollTop: 1_000_000,
    });
  });

  test("fails closed to defaults when browser storage is malformed", () => {
    expect(readOfficePreferences(memoryStorage("{"))).toEqual(
      DEFAULT_OFFICE_PREFERENCES,
    );
    expect(
      readOfficePreferences({
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => undefined,
      }),
    ).toEqual(DEFAULT_OFFICE_PREFERENCES);
  });

  test("writes only a normalized World-owned preference record", () => {
    const storage = memoryStorage(null);
    writeOfficePreferences(storage, {
      roomAlignment: "right",
      longTitleMode: "expand",
      inspectorPresentation: "floating",
      scrollLeft: 12.4,
      scrollTop: Number.POSITIVE_INFINITY,
    });

    expect(storage.value).toEqual({
      key: OFFICE_PREFERENCES_KEY,
      value: JSON.stringify({
        roomAlignment: "right",
        longTitleMode: "expand",
        inspectorPresentation: "floating",
        scrollLeft: 12,
        scrollTop: 0,
      }),
    });
  });
});

function memoryStorage(initial: string | null) {
  const storage = {
    value: null as { key: string; value: string } | null,
    getItem: () => initial,
    setItem(key: string, value: string) {
      storage.value = { key, value };
    },
  };
  return storage;
}
