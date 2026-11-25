import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  TERMINAL_INPUT_FOCUS_ATTRIBUTE,
  installTerminalInputFocusFlag,
} from "./terminalInputFocus";

async function withDocument(run: (browser: Window) => void) {
  const browser = new Window();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: browser.document,
  });
  try {
    run(browser);
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
    await browser.happyDOM.close();
  }
}

const flag = () =>
  document.documentElement.getAttribute(TERMINAL_INPUT_FOCUS_ATTRIBUTE);

test("the focus flag names the focused terminal input inside the App", async () => {
  await withDocument(() => {
    document.body.innerHTML = `
      <div class="app">
        <textarea class="xterm-helper-textarea"></textarea>
        <div class="terminal-composer"><textarea class="terminal-composer-input"></textarea></div>
        <div class="mobile-bottom-bar"><textarea class="terminal-composer-input" id="bar"></textarea></div>
        <input class="other">
      </div>
      <textarea class="terminal-composer-input" id="outside"></textarea>`;
    const [terminal, composer] = [
      ...document.querySelectorAll<HTMLElement>(".app textarea"),
    ];
    const uninstall = installTerminalInputFocusFlag();
    expect(flag()).toBeNull();
    terminal!.focus();
    expect(flag()).toBe("terminal");
    composer!.focus();
    expect(flag()).toBe("composer");
    document.querySelector<HTMLElement>("#bar")!.focus();
    expect(flag()).toBe("composer bar");
    // Outside the App shell, as the old `.app:has()` rule did not match.
    document.querySelector<HTMLElement>("#outside")!.focus();
    expect(flag()).toBeNull();
    composer!.focus();
    document.querySelector<HTMLElement>(".other")!.focus();
    expect(flag()).toBeNull();
    composer!.focus();
    (document.activeElement as HTMLElement).blur();
    expect(flag()).toBeNull();
    composer!.focus();
    uninstall();
    expect(flag()).toBeNull();
    terminal!.focus();
    expect(flag()).toBeNull();
  });
});

test("the focus flag stays while another App still has it installed", async () => {
  await withDocument(() => {
    document.body.innerHTML = `<div class="app"><textarea class="terminal-composer-input"></textarea></div>`;
    const first = installTerminalInputFocusFlag();
    const second = installTerminalInputFocusFlag();
    document.querySelector<HTMLElement>("textarea")!.focus();
    first();
    first();
    expect(flag()).toBe("composer");
    second();
    expect(flag()).toBeNull();
  });
});
