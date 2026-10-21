import { describe, expect, test } from "bun:test";
import {
  DEFAULT_OFFICE_PREFERENCES,
  OFFICE_PREFERENCES_KEY,
  readOfficePreferences,
  writeOfficePreferences,
} from "./officePreferences";

describe("View preferences", () => {
  test("keeps a choice saved before Office was retired and ignores Office-only fields", () => {
    const storage = memoryStorage(
      JSON.stringify({
        roomAlignment: "center",
        longTitleMode: "compact",
        inspectorPresentation: "docked",
        scrollLeft: 40,
        scrollTop: 90,
        townCalm: true,
      }),
    );
    expect(readOfficePreferences(storage)).toEqual({
      inspectorPresentation: "docked",
      townCalm: true,
    });
  });

  test("admits only known choices", () => {
    expect(
      readOfficePreferences(
        memoryStorage(JSON.stringify({ inspectorPresentation: "stacked" })),
      ),
    ).toEqual(DEFAULT_OFFICE_PREFERENCES);
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

  test("writes only the surviving fields, dropping Office-only ones", () => {
    const storage = memoryStorage(null);
    writeOfficePreferences(storage, {
      inspectorPresentation: "floating",
      townCalm: false,
    });
    expect(storage.value).toEqual({
      key: OFFICE_PREFERENCES_KEY,
      value: JSON.stringify({
        inspectorPresentation: "floating",
        townCalm: false,
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
