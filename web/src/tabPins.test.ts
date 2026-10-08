import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  __resetTabPinsForTests,
  forgetClosedTabPins,
  orderTabsForDisplay,
  paneCloseBlockReason,
  parseTabPins,
  PINNED_TAB_CLOSE_REASON,
  PINNED_TAB_LAST_PANE_CLOSE_REASON,
  setTabPinned,
  tabCloseBlockReason,
  tabPinsFor,
  withTabPinned,
} from "./tabPins";

const previousLocalStorage = globalThis.localStorage;
let storedValues = new Map<string, string>();

beforeEach(() => {
  storedValues = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return storedValues.size;
      },
      key: (index: number) => [...storedValues.keys()][index] ?? null,
      getItem: (key: string) => storedValues.get(key) ?? null,
      setItem: (key: string, value: string) => storedValues.set(key, value),
      removeItem: (key: string) => storedValues.delete(key),
      clear: () => storedValues.clear(),
    },
  });
  __resetTabPinsForTests();
});

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: previousLocalStorage,
  });
  __resetTabPinsForTests();
});

describe("tab pin display order", () => {
  const tabs = [
    { tab_id: "w1:t3", number: 3 },
    { tab_id: "w1:t1", number: 1 },
    { tab_id: "w1:t5", number: 5 },
    { tab_id: "w1:t2", number: 2 },
  ];

  test("keeps Herdr tab-list order without pins", () => {
    expect(
      orderTabsForDisplay(tabs, new Set()).map((tab) => tab.tab_id),
    ).toEqual(["w1:t3", "w1:t1", "w1:t5", "w1:t2"]);
  });

  test("moves pinned tabs first and keeps each group in list order", () => {
    expect(
      orderTabsForDisplay(tabs, new Set(["w1:t5", "w1:t3"])).map(
        (tab) => tab.tab_id,
      ),
    ).toEqual(["w1:t3", "w1:t5", "w1:t1", "w1:t2"]);
  });
});

describe("tab pin close guards", () => {
  const pinned = new Set(["w1:t1"]);
  const panes = [
    { pane_id: "p1", tab_id: "w1:t1" },
    { pane_id: "p2", tab_id: "w1:t1" },
    { pane_id: "p3", tab_id: "w1:t2" },
  ];

  test("blocks closing a pinned tab only", () => {
    expect(tabCloseBlockReason("w1:t1", pinned)).toBe(PINNED_TAB_CLOSE_REASON);
    expect(tabCloseBlockReason("w1:t2", pinned)).toBeNull();
  });

  test("allows closing a pinned tab's pane while another remains", () => {
    expect(paneCloseBlockReason("p1", panes, pinned)).toBeNull();
    expect(paneCloseBlockReason("p3", panes, pinned)).toBeNull();
  });

  test("blocks closing the last pane of a pinned tab", () => {
    const lastPane = panes.filter((pane) => pane.pane_id !== "p2");
    expect(paneCloseBlockReason("p1", lastPane, pinned)).toBe(
      PINNED_TAB_LAST_PANE_CLOSE_REASON,
    );
  });

  test("ignores panes that are no longer listed", () => {
    expect(paneCloseBlockReason("gone", panes, pinned)).toBeNull();
  });
});

describe("tab pin state", () => {
  test("parses stored pins defensively", () => {
    expect(parseTabPins('["w1:t1", 3, "", "w1:t1", "w1:t2"]')).toEqual([
      "w1:t1",
      "w1:t2",
    ]);
    expect(parseTabPins("not json")).toEqual([]);
    expect(parseTabPins('{"w1:t1": true}')).toEqual([]);
    expect(parseTabPins(null)).toEqual([]);
  });

  test("toggles a pin without duplicating it", () => {
    expect(withTabPinned(["w1:t1"], "w1:t2", true)).toEqual(["w1:t1", "w1:t2"]);
    expect(withTabPinned(["w1:t1", "w1:t2"], "w1:t1", true)).toEqual([
      "w1:t2",
      "w1:t1",
    ]);
    expect(withTabPinned(["w1:t1", "w1:t2"], "w1:t1", false)).toEqual([
      "w1:t2",
    ]);
  });

  test("persists pins per connection across reloads", () => {
    setTabPinned("alpha", "w1:t1", true);
    setTabPinned("beta", "w1:t2", true);
    __resetTabPinsForTests();
    expect([...tabPinsFor("alpha")]).toEqual(["w1:t1"]);
    expect([...tabPinsFor("beta")]).toEqual(["w1:t2"]);
    expect(tabPinsFor("gamma").size).toBe(0);
  });

  test("forgets pins for tabs closed elsewhere", () => {
    setTabPinned("alpha", "w1:t1", true);
    setTabPinned("alpha", "w1:t2", true);
    forgetClosedTabPins("alpha", new Set(["w1:t1", "w1:t3"]));
    __resetTabPinsForTests();
    expect([...tabPinsFor("alpha")]).toEqual(["w1:t1"]);
  });

  test("keeps pins while Herdr lists no tabs", () => {
    setTabPinned("alpha", "w1:t1", true);
    forgetClosedTabPins("alpha", new Set());
    expect([...tabPinsFor("alpha")]).toEqual(["w1:t1"]);
  });

  test("keeps pin changes and pruning usable when storage writes fail", () => {
    localStorage.setItem = () => {
      throw new DOMException("Storage full", "QuotaExceededError");
    };
    expect(() => setTabPinned("alpha", "w1:t1", true)).not.toThrow();
    expect(tabPinsFor("alpha").has("w1:t1")).toBe(true);
    expect(() => setTabPinned("alpha", "w1:t1", false)).not.toThrow();
    expect(tabPinsFor("alpha").size).toBe(0);
    setTabPinned("alpha", "w1:t1", true);
    expect(() =>
      forgetClosedTabPins("alpha", new Set(["w1:t2"])),
    ).not.toThrow();
    expect(tabPinsFor("alpha").size).toBe(0);
  });
});
