import { describe, expect, test } from "bun:test";
import { boardTabKey } from "./board/boardModel";
import {
  defaultTerminalColor,
  resolveTerminal,
  TERMINAL_COLORS,
  terminalColor,
  terminalColorKey,
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
    ).toEqual({ color: defaultTerminalColor("studio:w1:t1"), own: false });
  });

  test("defaults are deterministic, spread over the palette and per connection", () => {
    expect(terminalColor({}, tab("w1:t1"))).toBe(
      defaultTerminalColor("studio:w1:t1"),
    );
    expect(defaultTerminalColor("studio:w1:t1")).toBe(
      defaultTerminalColor("studio:w1:t1"),
    );
    const used = new Set(
      Array.from({ length: 40 }, (_, i) => defaultTerminalColor(`h:w1:t${i}`)),
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
