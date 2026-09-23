import { describe, expect, test } from "bun:test";
import { formatUiDateTime, formatUiRelativeTime, UI_LOCALE } from "./uiLocale";

describe("UI locale", () => {
  test("formats local dates with 24-hour time and years only outside the current year", () => {
    const now = new Date(2026, 8, 20);
    for (const [date, expected] of [
      [new Date(2026, 0, 2, 0, 5), "01-02 00:05"],
      [new Date(2026, 8, 20, 17, 38), "09-20 17:38"],
      [new Date(2025, 11, 31, 23, 59), "2025-12-31 23:59"],
      [new Date(2027, 0, 1, 0, 0), "2027-01-01 00:00"],
    ] as const) {
      expect(formatUiDateTime(date.toISOString(), now)).toBe(expected);
    }
    expect(formatUiDateTime("unknown", now)).toBe("unknown");
  });

  test("keeps generated relative-time labels in English", () => {
    expect(UI_LOCALE).toBe("en-US");
    expect(formatUiRelativeTime(0, "second")).toBe("now");
    expect(formatUiRelativeTime(-2, "minute")).toBe("2 minutes ago");
    expect(formatUiRelativeTime(1, "day")).toBe("tomorrow");
  });
});
