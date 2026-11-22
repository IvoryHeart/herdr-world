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
      townOpens: "chat",
      townBuildings: "host",
      townRoomsPerRow: "auto",
      townGreeting: true,
      tabBadge: true,
      townQuietMinutes: 10,
    });
  });

  test("Town keeps a building per host unless per runtime was chosen", () => {
    const read = (townBuildings: unknown) =>
      readOfficePreferences(memoryStorage(JSON.stringify({ townBuildings })))
        .townBuildings;
    expect(DEFAULT_OFFICE_PREFERENCES.townBuildings).toBe("host");
    expect(read("runtime")).toBe("runtime");
    expect(read("host")).toBe("host");
    expect(read("machine")).toBe("host");
  });

  test("Town's rooms per row is Auto unless a count from 2 to 5 was chosen", () => {
    const read = (townRoomsPerRow: unknown) =>
      readOfficePreferences(memoryStorage(JSON.stringify({ townRoomsPerRow })))
        .townRoomsPerRow;
    expect(DEFAULT_OFFICE_PREFERENCES.townRoomsPerRow).toBe("auto");
    for (const count of [2, 3, 4, 5] as const) expect(read(count)).toBe(count);
    expect(read(6)).toBe("auto");
    expect(read("3")).toBe("auto");
    expect(read("auto")).toBe("auto");
  });

  test("Town marks quiet working agents after 10 minutes unless changed", () => {
    const read = (townQuietMinutes: unknown) =>
      readOfficePreferences(memoryStorage(JSON.stringify({ townQuietMinutes })))
        .townQuietMinutes;
    expect(DEFAULT_OFFICE_PREFERENCES.townQuietMinutes).toBe(10);
    expect(read(30)).toBe(30);
    expect(read(0)).toBe(0);
    expect(read(7)).toBe(10);
    expect(read("off")).toBe(10);
  });

  test("the tab and app icon count is on unless it was turned off", () => {
    const read = (tabBadge: unknown) =>
      readOfficePreferences(memoryStorage(JSON.stringify({ tabBadge })))
        .tabBadge;
    expect(DEFAULT_OFFICE_PREFERENCES.tabBadge).toBe(true);
    expect(read(false)).toBe(false);
    expect(read(true)).toBe(true);
    expect(read("no")).toBe(true);
  });

  test("the Town Master's greeting is on unless it was turned off", () => {
    const read = (townGreeting: unknown) =>
      readOfficePreferences(memoryStorage(JSON.stringify({ townGreeting })))
        .townGreeting;
    expect(DEFAULT_OFFICE_PREFERENCES.townGreeting).toBe(true);
    expect(read(false)).toBe(false);
    expect(read(true)).toBe(true);
    expect(read("no")).toBe(true);
  });

  test("Town opens Chat unless Terminal was chosen", () => {
    const read = (townOpens: unknown) =>
      readOfficePreferences(memoryStorage(JSON.stringify({ townOpens })))
        .townOpens;
    expect(DEFAULT_OFFICE_PREFERENCES.townOpens).toBe("chat");
    expect(read("terminal")).toBe("terminal");
    expect(read("chat")).toBe("chat");
    expect(read("browser")).toBe("chat");
  });

  test("the retired Town master name is not a view preference", () => {
    expect(
      readOfficePreferences(
        memoryStorage(JSON.stringify({ townMaster: "lead" })),
      ),
    ).toEqual(DEFAULT_OFFICE_PREFERENCES);
    expect(DEFAULT_OFFICE_PREFERENCES).not.toHaveProperty("townMaster");
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
      townOpens: "terminal",
      townBuildings: "runtime",
      townRoomsPerRow: 4,
      townGreeting: false,
      tabBadge: false,
      townQuietMinutes: 30,
    });
    expect(storage.value).toEqual({
      key: OFFICE_PREFERENCES_KEY,
      value: JSON.stringify({
        inspectorPresentation: "floating",
        townCalm: false,
        townOpens: "terminal",
        townBuildings: "runtime",
        townRoomsPerRow: 4,
        townGreeting: false,
        tabBadge: false,
        townQuietMinutes: 30,
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
