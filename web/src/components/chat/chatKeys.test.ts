import { expect, test } from "bun:test";
import {
  defaultMobileTerminalShortcutRows,
  MOBILE_TERMINAL_SHORTCUT_OPTIONS,
} from "../../mobileTerminalShortcuts";
import { mobileTerminalKeyCombinationBytes } from "../../mobileTerminalKeyCombination";
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

test("custom combinations send what the Terminal sends", () => {
  const combo = (
    key: string,
    mods: Partial<Record<"ctrl" | "alt" | "shift", boolean>> = {},
  ) => chatKeyName({ key, ctrl: false, alt: false, shift: false, ...mods });
  // Settings stores the unshifted key and a Shift flag.
  expect(combo("a", { shift: true })).toBe("A");
  expect(combo("1", { shift: true })).toBe("!");
  expect(combo("/", { shift: true })).toBe("?");
  expect(combo("1", { alt: true, shift: true })).toBe("alt+!");
  expect(combo("x", { ctrl: true })).toBe("ctrl+x");
  expect(combo("x", { ctrl: true, shift: true })).toBe("ctrl+shift+x");
  expect(combo("y", { ctrl: true, alt: true, shift: true })).toBe(
    "ctrl+alt+shift+y",
  );
  expect(combo("?")).toBe("?");
  expect(combo("Tab", { shift: true })).toBe("shift+tab");
  expect(combo("ArrowUp", { alt: true })).toBe("alt+up");
  expect(combo("Enter", { shift: true })).toBe("shift+enter");
  expect(combo("Space", { shift: true })).toBe("space");
  expect(combo("F5")).toBe("f5");
  // What the Terminal refuses, or Herdr cannot name, stays disabled.
  expect(combo("1", { ctrl: true, shift: true })).toBe(null);
  expect(combo("Escape", { shift: true })).toBe(null);
  expect(combo("Tab", { ctrl: true })).toBe(null);
  expect(combo("PageUp")).toBe(null);
  expect(combo("Delete", { ctrl: true })).toBe(null);
});

test("printable keys with Shift or Alt match the Terminal's bytes", () => {
  for (const key of "abzo019-=[]\\;',./`")
    for (const shift of [false, true])
      for (const alt of [false, true]) {
        const action = { key, ctrl: false, alt, shift };
        const bytes = mobileTerminalKeyCombinationBytes(action);
        const text = String.fromCharCode(...bytes);
        const name = chatKeyName(action);
        // Herdr's alt+<c> sends ESC then <c>, as the Terminal does; a key
        // the Terminal sends as its own code (Alt+[) is not pressed.
        expect([key, shift, alt, name]).toEqual([
          key,
          shift,
          alt,
          text.startsWith("\x1b[") ? null : alt ? `alt+${text.slice(1)}` : text,
        ]);
      }
});
