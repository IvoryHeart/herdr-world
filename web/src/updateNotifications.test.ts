import { expect, test } from "bun:test";
import { createUpdateNotificationHistory } from "./updateNotifications";

test("history survives a new page and versions remain independent", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  expect(createUpdateNotificationHistory(storage).claim("1.2.3")).toBe(true);
  expect(createUpdateNotificationHistory(storage).claim("1.2.3")).toBe(false);
  expect(createUpdateNotificationHistory(storage).claim("1.2.4")).toBe(true);
  expect(createUpdateNotificationHistory(storage).claim("1.2.3")).toBe(false);
  const otherOrigin = createUpdateNotificationHistory({
    getItem: () => null,
    setItem() {},
  });
  expect(otherOrigin.claim("1.2.3")).toBe(true);
});

test("restricted storage still deduplicates for the current page", () => {
  const history = createUpdateNotificationHistory({
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
  });
  expect(history.claim("1.2.3")).toBe(true);
  expect(history.claim("1.2.3")).toBe(false);
  expect(history.claim("1.2.4")).toBe(true);
});
