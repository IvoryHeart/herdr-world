import { describe, expect, it } from "vitest";

import {
  encodeMobileTerminalChord,
  MOBILE_TERMINAL_SPECIAL_KEYS,
  mobileTerminalPrintableKey,
} from "./mobileTerminalControls";

describe("encodeMobileTerminalChord", () => {
  it("encodes Ctrl+Shift+Up using the xterm modifier parameter", () => {
    expect(encodeMobileTerminalChord(specialKey("arrow-up"), ["ctrl", "shift"])).toBe("\x1B[1;6A");
  });

  it("prefixes printable Alt chords with Escape", () => {
    expect(encodeMobileTerminalChord(mobileTerminalPrintableKey("p"), ["alt"])).toBe("\x1Bp");
  });

  it("encodes control letters before applying Alt", () => {
    expect(encodeMobileTerminalChord(mobileTerminalPrintableKey("c"), ["ctrl"])).toBe("\x03");
    expect(encodeMobileTerminalChord(mobileTerminalPrintableKey("p"), ["ctrl", "alt"])).toBe(
      "\x1B\x10",
    );
  });

  it("preserves unmodified special keys and adds modifiers to tilde keys", () => {
    expect(encodeMobileTerminalChord(specialKey("arrow-left"), [])).toBe("\x1B[D");
    expect(encodeMobileTerminalChord(specialKey("delete"), ["alt"])).toBe("\x1B[3;3~");
  });

  it("uses the standard Shift+Tab sequence", () => {
    expect(encodeMobileTerminalChord(specialKey("tab"), ["shift"])).toBe("\x1B[Z");
  });

  it.each([
    ["backspace", ["alt"], "\x1B\x7F"],
    ["backspace", ["ctrl"], "\x08"],
    ["backspace", ["ctrl", "alt"], "\x1B\x08"],
    ["backspace", ["shift", "alt"], "\x1B\x7F"],
    ["tab", ["alt"], "\x1B\t"],
    ["tab", ["ctrl"], "\t"],
    ["tab", ["shift", "alt"], "\x1B\x1B[Z"],
    ["escape", ["alt"], "\x1B\x1B"],
    ["escape", ["shift"], "\x1B"],
  ] as const)("encodes %s with %s as legacy terminal input", (id, modifiers, expected) => {
    expect(encodeMobileTerminalChord(specialKey(id), modifiers)).toBe(expected);
  });

  it("applies Shift to printable punctuation and digits", () => {
    expect(encodeMobileTerminalChord(mobileTerminalPrintableKey("1"), ["shift"])).toBe("!");
    expect(encodeMobileTerminalChord(mobileTerminalPrintableKey("["), ["shift"])).toBe("{");
  });

  it("encodes conventional Ctrl digit aliases", () => {
    expect(encodeMobileTerminalChord(mobileTerminalPrintableKey("2"), ["ctrl"])).toBe("\x00");
    expect(encodeMobileTerminalChord(mobileTerminalPrintableKey("7"), ["ctrl"])).toBe("\x1F");
  });
});

function specialKey(id: string) {
  const key = MOBILE_TERMINAL_SPECIAL_KEYS.find((candidate) => candidate.id === id);
  if (!key) {
    throw new Error(`missing test special key: ${id}`);
  }
  return key;
}
