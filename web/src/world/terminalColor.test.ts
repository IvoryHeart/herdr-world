import { describe, expect, test } from "bun:test";
import { boardTabKey } from "./board/boardModel";
import {
  customTerminalColor,
  defaultTerminalColor,
  TERMINAL_COLORS,
  terminalColor,
  terminalColorKey,
} from "./terminalColor";

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
    expect(customTerminalColor({}, tab("w1:t1"))).toBeNull();
    expect(terminalColor({ "studio:w1": "pink" }, tab("w1:t1"))).toBe("pink");
    expect(
      terminalColor(
        { "studio:w1": "pink", "studio:w1:t1": "teal" },
        tab("w1:t1"),
      ),
    ).toBe("teal");
    // Another host's tab with the same Herdr ID is a different terminal.
    expect(
      customTerminalColor({ "studio:w1:t1": "teal" }, tab("w1:t1", "lab")),
    ).toBeNull();
  });
});
