import { describe, expect, test } from "bun:test";
import {
  DEFAULT_OFFICE_PREFERENCES,
  OFFICE_PREFERENCES_KEY,
  readOfficePreferences,
  writeOfficePreferences,
} from "./officePreferences";

describe("Office preferences", () => {
  test("admits only known choices and ignores retired Pixel Office fields", () => {
    const storage = memoryStorage(
      JSON.stringify({
        roomAlignment: "sideways",
        longTitleMode: "compact",
        inspectorPresentation: "stacked",
        scrollLeft: -4,
        calm: "yes",
      }),
    );

    expect(readOfficePreferences(storage)).toEqual({
      inspectorPresentation: "floating",
      calm: false,
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
      inspectorPresentation: "docked",
      calm: true,
    });

    expect(storage.value).toEqual({
      key: OFFICE_PREFERENCES_KEY,
      value: JSON.stringify({ inspectorPresentation: "docked", calm: true }),
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
