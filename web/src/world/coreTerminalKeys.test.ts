import { expect, test } from "bun:test";
import { terminalKey, typedKey } from "./coreTerminalKeys";

const key = (
  name: string,
  mods: Partial<
    Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">
  > = {},
) =>
  ({
    key: name,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    ...mods,
  }) as KeyboardEvent;

test("a terminal key held while the watch loads is what xterm would send", () => {
  expect(terminalKey(key("a"))).toBe("a");
  expect(terminalKey(key("A", { shiftKey: true }))).toBe("A");
  expect(terminalKey(key("Enter"))).toBe("\r");
  expect(terminalKey(key("Backspace"))).toBe("\x7f");
  expect(terminalKey(key("Escape"))).toBe("\x1b");
  expect(terminalKey(key("Tab"))).toBe("\t");
  expect(terminalKey(key("Tab", { shiftKey: true }))).toBe("\x1b[Z");
  expect(terminalKey(key("c", { ctrlKey: true }))).toBe("\x03");
  expect(terminalKey(key("u", { ctrlKey: true }))).toBe("\x15");
  expect(terminalKey(key("[", { ctrlKey: true }))).toBe("\x1b");
  expect(terminalKey(key("ArrowUp"))).toBe("\x1b[A");
  expect(terminalKey(key("ArrowLeft", { ctrlKey: true }))).toBe("\x1b[1;5D");
  expect(terminalKey(key("Delete"))).toBe("\x1b[3~");
  expect(terminalKey(key("PageDown", { shiftKey: true }))).toBe("\x1b[6;2~");
});

test("keys the browser keeps are not held for the terminal", () => {
  expect(terminalKey(key("c", { metaKey: true }))).toBeNull();
  expect(terminalKey(key("v", { ctrlKey: true }))).toBeNull();
  expect(terminalKey(key("I", { ctrlKey: true, shiftKey: true }))).toBeNull();
  expect(terminalKey(key("F5"))).toBeNull();
  expect(terminalKey(key("Shift", { shiftKey: true }))).toBeNull();
});

test("keys typed outside the terminal stay plain text and Enter", () => {
  expect(typedKey(key("a"))).toBe("a");
  expect(typedKey(key("c", { ctrlKey: true }))).toBeNull();
  expect(typedKey(key("ArrowUp"))).toBeNull();
});
