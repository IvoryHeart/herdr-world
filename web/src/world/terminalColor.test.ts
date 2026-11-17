import { describe, expect, test } from "bun:test";
import { boardTabKey } from "./board/boardModel";
import {
  defaultRoomColor,
  hostColorKey,
  placeColor,
  resolveTerminal,
  workspaceColorKey,
  TERMINAL_COLOR_HEX,
  TERMINAL_COLORS,
  terminalColor,
  terminalColorKey,
  type TerminalColor,
} from "./terminalColor";
import { keepColors } from "./useTerminalColors";

const tab = (tabId: string, connectionId = "studio") => ({
  connectionId,
  workspaceId: "w1",
  tabId,
  workspaceIds: new Set(["w1", "w2"]),
});

describe("terminal colour", () => {
  test("is saved under the tab's Board card key", () => {
    expect(terminalColorKey(tab("w1:t1"))).toBe("studio:w1:t1");
    expect(terminalColorKey(tab("w1:t1"))).toBe(
      boardTabKey("studio", "w1:t1", new Set(["w1"])),
    );
    // Older Herdr can give a tab its workspace's ID; Board qualifies it.
    expect(terminalColorKey(tab("w2"))).toBe("studio:tab:w2");
  });

  test("a saved colour outside the palette shows the default and is not the tab's own", () => {
    const colors = { "studio:w1:t1": "chartreuse", "studio:w1": "mauve" };
    expect(
      resolveTerminal(
        colors as unknown as Parameters<typeof resolveTerminal>[0],
        tab("w1:t1"),
      ),
    ).toEqual({ color: defaultRoomColor("studio:w1"), own: false });
  });

  test("a tab without a colour shows its room's default, so a room is one colour", () => {
    // Every tab in a room shares the room's default, whatever its ID.
    for (let i = 0; i < 20; i += 1)
      expect(terminalColor({}, tab(`w1:t${i}`))).toBe(
        defaultRoomColor("studio:w1"),
      );
    expect(resolveTerminal({}, tab("w1:t1")).own).toBe(false);
    // The default tells rooms apart: deterministic, spread over the palette
    // and per connection.
    expect(defaultRoomColor("studio:w1")).toBe(defaultRoomColor("studio:w1"));
    const used = new Set(
      Array.from({ length: 40 }, (_, i) => defaultRoomColor(`h:w${i}`)),
    );
    expect(used.size).toBeGreaterThan(4);
    for (const color of used) expect(TERMINAL_COLORS).toContain(color);
  });

  test("a chosen colour wins, then the workspace's, then the default", () => {
    expect(resolveTerminal({}, tab("w1:t1")).own).toBe(false);
    // An inherited workspace colour is not the tab's own: nothing to reset.
    expect(resolveTerminal({ "studio:w1": "pink" }, tab("w1:t1"))).toEqual({
      color: "pink",
      own: false,
    });
    expect(terminalColor({ "studio:w1": "pink" }, tab("w1:t1"))).toBe("pink");
    expect(
      terminalColor(
        { "studio:w1": "pink", "studio:w1:t1": "teal" },
        tab("w1:t1"),
      ),
    ).toBe("teal");
    // Another host's tab with the same Herdr ID is a different terminal.
    expect(
      resolveTerminal({ "studio:w1:t1": "teal" }, tab("w1:t1", "lab")).own,
    ).toBe(false);
  });

  test("a Board revision that changes no colour keeps the same colours object", () => {
    const last = { "studio:w1:t1": "teal" } as const;
    expect(keepColors(last, { "studio:w1:t1": "teal" })).toBe(last);
    const changed = { "studio:w1:t1": "pink" } as const;
    expect(keepColors(last, changed)).toBe(changed);
    expect(keepColors(last, {})).toEqual({});
  });
});

describe("place colours", () => {
  test("a workspace's is saved under its card key, a host's under its own", () => {
    expect(workspaceColorKey("studio", "w1")).toBe("studio:w1");
    expect(hostColorKey("studio")).toBe("@host:studio");
    // A host key can never be a card key, which starts with "<connection>:".
    expect(hostColorKey("studio").startsWith("studio:")).toBe(false);
  });

  test("a place shows only a chosen palette colour; none means its default", () => {
    const colors = { "studio:w1": "teal", "@host:studio": "mauve" } as const;
    expect(placeColor(colors as never, "studio:w1")).toBe("teal");
    expect(placeColor(colors as never, "@host:studio")).toBeNull();
    expect(placeColor({}, "studio:w2")).toBeNull();
  });

  test("tabs inherit a workspace's colour but never the host's", () => {
    const other = { ...tab("w2:t1"), workspaceId: "w2" };
    const fallback = defaultRoomColor(workspaceColorKey("studio", "w2"));
    // A host colour unlike the tab's default, so inheriting it would show.
    const hostColor = TERMINAL_COLORS.find(
      (c) => c !== fallback && c !== "teal",
    )!;
    const colors: Record<string, TerminalColor> = {
      "studio:w1": "teal",
      "@host:studio": hostColor,
    };
    expect(terminalColor(colors, tab("w1:t1"))).toBe("teal");
    expect(terminalColor(colors, other)).toBe(fallback);
    // A tab's own colour is never overwritten by either.
    expect(
      terminalColor({ ...colors, "studio:w1:t1": "red" }, tab("w1:t1")),
    ).toBe("red");
  });
});

/*
 * Quiet identity, loud attention (#890). Identity tones are measured in OKLCH
 * against the status colours of both themes (tokens.css, AgentMark.css).
 */
const linear = (hex: string) =>
  [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
const oklch = (hex: string) => {
  const [r, g, b] = linear(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B) };
};
const luminance = (hex: string) => {
  const [r, g, b] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
/** Working, needs you, asks you, done and offline, dark then light. */
const STATUS = [
  ["#7aa2f7", "#f0c453", "#6ca9ee", "#54d17a", "#ff6b6b"],
  ["#2e7de9", "#a36f00", "#6ca9ee", "#248b4c", "#d03b3b"],
].flat();
/** Dark and light theme backgrounds, and Board's whiteboard. */
const SURFACES = ["#1a1b26", "#e1e2e7", "#ffffff"];

describe("the identity palette", () => {
  const tones = TERMINAL_COLORS.map((name) => TERMINAL_COLOR_HEX[name]);

  test("is quiet: every status colour is at least 1.75 times as chromatic", () => {
    const loudest = Math.max(...tones.map((hex) => oklch(hex).C));
    const quietestStatus = Math.min(...STATUS.map((hex) => oklch(hex).C));
    expect(loudest * 1.75).toBeLessThanOrEqual(quietestStatus);
  });

  test("is one set: every tone the same value, every hue its own", () => {
    const values = tones.map((hex) => oklch(hex).L);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThan(0.01);
    expect(new Set(tones).size).toBe(TERMINAL_COLORS.length);
  });

  test("keeps 3:1 contrast on dark, light and white surfaces", () => {
    for (const hex of tones)
      for (const surface of SURFACES)
        expect(contrast(hex, surface)).toBeGreaterThanOrEqual(3);
  });
});
