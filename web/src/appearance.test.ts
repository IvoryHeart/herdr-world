import { describe, expect, test } from "bun:test";
import {
  clampTerminalFontScale,
  clampUiScale,
  MAX_TERMINAL_FONT_NAME_LENGTH,
  normalizeAccentColor,
  normalizeTerminalFontFamily,
  normalizeTerminalFontScale,
  normalizeThemePreference,
  normalizeUiScale,
  normalizeZenMode,
  resolveSystemTheme,
  serializeZenMode,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SCALE_DEFAULT,
  TERMINAL_FONT_SCALE_MAX,
  TERMINAL_FONT_SCALE_MIN,
  terminalFontFamilyStack,
  terminalFontOptions,
  UI_SCALE_DEFAULT,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
} from "./appearance";

const matches = (value: boolean) => ({ matches: value });

describe("appearance preferences", () => {
  test("accepts supported accent colors", () => {
    expect(normalizeAccentColor("neutral")).toBe("neutral");
    expect(normalizeAccentColor("teal")).toBe("teal");
    expect(normalizeAccentColor("amber")).toBe("amber");
    expect(normalizeAccentColor("violet")).toBe("violet");
  });

  test("falls back to the original neutral theme for missing or unknown values", () => {
    expect(normalizeAccentColor(null)).toBe("neutral");
    expect(normalizeAccentColor("")).toBe("neutral");
    expect(normalizeAccentColor("orange")).toBe("neutral");
  });

  test("accepts supported theme preferences, including system", () => {
    expect(normalizeThemePreference("dark")).toBe("dark");
    expect(normalizeThemePreference("light")).toBe("light");
    expect(normalizeThemePreference("system")).toBe("system");
  });

  test("falls back to the dark theme for missing or unknown values", () => {
    expect(normalizeThemePreference(null)).toBe("dark");
    expect(normalizeThemePreference("")).toBe("dark");
    expect(normalizeThemePreference("auto")).toBe("dark");
  });

  test("resolves the system theme from the color-scheme media query", () => {
    expect(resolveSystemTheme(matches(true))).toBe("light");
    expect(resolveSystemTheme(matches(false))).toBe("dark");
  });
});

describe("clampUiScale", () => {
  test("keeps in-range values on the step grid", () => {
    expect(clampUiScale(100)).toBe(100);
    expect(clampUiScale(125)).toBe(125);
  });

  test("rounds values to the nearest step", () => {
    expect(clampUiScale(103)).toBe(105);
    expect(clampUiScale(102)).toBe(100);
  });

  test("clamps to the supported range", () => {
    expect(clampUiScale(10)).toBe(UI_SCALE_MIN);
    expect(clampUiScale(500)).toBe(UI_SCALE_MAX);
  });

  test("falls back to the default for non-finite values", () => {
    expect(clampUiScale(Number.NaN)).toBe(UI_SCALE_DEFAULT);
    expect(clampUiScale(Number.POSITIVE_INFINITY)).toBe(UI_SCALE_DEFAULT);
  });
});

describe("normalizeUiScale", () => {
  test("defaults when nothing is stored", () => {
    expect(normalizeUiScale(null)).toBe(UI_SCALE_DEFAULT);
  });

  test("defaults for unparsable stored values", () => {
    expect(normalizeUiScale("large")).toBe(UI_SCALE_DEFAULT);
  });

  test("parses and clamps stored values", () => {
    expect(normalizeUiScale("110")).toBe(110);
    expect(normalizeUiScale("999")).toBe(UI_SCALE_MAX);
  });
});

describe("clampTerminalFontScale", () => {
  test("rounds values to the nearest step", () => {
    expect(clampTerminalFontScale(150)).toBe(150);
    expect(clampTerminalFontScale(103)).toBe(105);
  });

  test("clamps to the supported range", () => {
    expect(clampTerminalFontScale(10)).toBe(TERMINAL_FONT_SCALE_MIN);
    expect(clampTerminalFontScale(500)).toBe(TERMINAL_FONT_SCALE_MAX);
  });

  test("falls back to the default for non-finite values", () => {
    expect(clampTerminalFontScale(Number.NaN)).toBe(
      TERMINAL_FONT_SCALE_DEFAULT,
    );
  });
});

describe("normalizeTerminalFontScale", () => {
  test("defaults when nothing is stored", () => {
    expect(normalizeTerminalFontScale(null, null)).toBe(
      TERMINAL_FONT_SCALE_DEFAULT,
    );
  });

  test("parses and clamps its own stored value, ignoring the UI scale", () => {
    expect(normalizeTerminalFontScale("180", "90")).toBe(180);
    expect(normalizeTerminalFontScale("999", "90")).toBe(
      TERMINAL_FONT_SCALE_MAX,
    );
    expect(normalizeTerminalFontScale("large", "90")).toBe(
      TERMINAL_FONT_SCALE_DEFAULT,
    );
  });

  test("inherits a UI scale saved before terminal text was split out", () => {
    expect(normalizeTerminalFontScale(null, "125")).toBe(125);
    expect(normalizeTerminalFontScale(null, "large")).toBe(UI_SCALE_DEFAULT);
  });
});

describe("terminalFontOptions", () => {
  test("scales the desktop and compact base sizes", () => {
    expect(terminalFontOptions(false, 100).fontSize).toBe(13);
    expect(terminalFontOptions(false, 200).fontSize).toBe(26);
    expect(terminalFontOptions(true, 150).fontSize).toBe(18);
  });
});

describe("normalizeTerminalFontFamily", () => {
  test("keeps a plain family name and collapses whitespace", () => {
    expect(normalizeTerminalFontFamily("JetBrains Mono")).toBe(
      "JetBrains Mono",
    );
    expect(normalizeTerminalFontFamily("  Sarasa   Mono TC ")).toBe(
      "Sarasa Mono TC",
    );
  });

  test("treats missing or blank values as the default stack", () => {
    expect(normalizeTerminalFontFamily(null)).toBe("");
    expect(normalizeTerminalFontFamily("   ")).toBe("");
  });

  test("drops characters that would escape the quoted family name", () => {
    expect(normalizeTerminalFontFamily('Evil", monospace; x{')).toBe(
      "Evil monospace x",
    );
    expect(normalizeTerminalFontFamily("A\\B\n'C'")).toBe("ABC");
  });

  test("caps the stored name length", () => {
    expect(normalizeTerminalFontFamily("a".repeat(300))).toHaveLength(
      MAX_TERMINAL_FONT_NAME_LENGTH,
    );
  });
});

describe("terminalFontFamilyStack", () => {
  test("uses the default stack without a preferred font", () => {
    expect(terminalFontFamilyStack("")).toBe(TERMINAL_FONT_FAMILY);
  });

  test("leads the default stack with the quoted preferred font", () => {
    expect(terminalFontFamilyStack("Cascadia Code")).toBe(
      `"Cascadia Code", ${TERMINAL_FONT_FAMILY}`,
    );
  });
});

describe("zen mode", () => {
  test("stays off until it is stored", () => {
    expect(normalizeZenMode(null)).toBe(false);
    expect(normalizeZenMode("")).toBe(false);
    expect(normalizeZenMode("true")).toBe(false);
  });

  test("round-trips through storage", () => {
    expect(normalizeZenMode(serializeZenMode(true))).toBe(true);
    expect(normalizeZenMode(serializeZenMode(false))).toBe(false);
  });
});
