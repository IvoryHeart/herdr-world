import { expect, test } from "bun:test";
import {
  defaultMobileTerminalShortcutRows,
  MOBILE_TERMINAL_SHORTCUT_OPTIONS,
} from "../../mobileTerminalShortcuts";
import { chatKeyName } from "./chatKeys";

test("Chat presses the Terminal's key controls by Herdr's key names", () => {
  const names = Object.fromEntries(
    MOBILE_TERMINAL_SHORTCUT_OPTIONS.map((option) => [
      option.id,
      chatKeyName(option.id),
    ]),
  );
  expect(names).toMatchObject({
    "ctrl-c": "ctrl+c",
    "ctrl-r": "ctrl+r",
    escape: "esc",
    tab: "tab",
    enter: "enter",
    backspace: "backspace",
    "arrow-up": "up",
    "arrow-left": "left",
    "alt-up": "alt+up",
    "shift-enter": "shift+enter",
    // Scrolling, and keys Herdr has no name for, stay in the Terminal.
    "page-up": null,
    "page-down": null,
    "alt-page-up": null,
    home: null,
    end: null,
    delete: null,
  });
  // Every default except paging can be pressed from Chat.
  const defaults = defaultMobileTerminalShortcutRows()
    .flat()
    .filter((shortcut) => shortcut !== null);
  expect(
    defaults
      .filter((shortcut) => chatKeyName(shortcut.action) === null)
      .map((shortcut) => shortcut.action),
  ).toEqual(["page-up", "page-down"]);
});

test("custom combinations keep their modifiers", () => {
  const combo = (
    key: string,
    mods: Partial<Record<"ctrl" | "alt" | "shift", boolean>> = {},
  ) => chatKeyName({ key, ctrl: false, alt: false, shift: false, ...mods });
  expect(combo("x", { ctrl: true })).toBe("ctrl+x");
  expect(combo("X", { ctrl: true, shift: true })).toBe("ctrl+x");
  expect(combo("?")).toBe("?");
  expect(combo("Tab", { shift: true })).toBe("shift+tab");
  expect(combo("ArrowUp", { alt: true })).toBe("alt+up");
  expect(combo("F5")).toBe("f5");
  expect(combo("PageUp")).toBe(null);
  expect(combo("Delete", { ctrl: true })).toBe(null);
});
