import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { requestChatInputFocus } from "./chatFocus";

async function withEditors(
  run: (
    browser: Window,
    first: HTMLTextAreaElement,
    second: HTMLTextAreaElement,
  ) => void,
) {
  const browser = new Window();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: browser.document,
  });
  const first = browser.document.createElement("textarea");
  const second = browser.document.createElement("textarea");
  browser.document.body.append(first, second);
  try {
    run(
      browser,
      first as unknown as HTMLTextAreaElement,
      second as unknown as HTMLTextAreaElement,
    );
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
    await browser.happyDOM.close();
  }
}

test("a focus request can be consumed only once, and a newer open retires an older one", async () => {
  await withEditors((_browser, first, second) => {
    const older = requestChatInputFocus();
    const newer = requestChatInputFocus();
    expect(newer.focus(second)).toBe(true);
    expect(older.focus(first)).toBe(false);
    expect(document.activeElement === second).toBe(true);
    first.focus();
    expect(newer.focus(second)).toBe(false);
    expect(document.activeElement === first).toBe(true);
  });
});

test("moving focus or typing while loading cancels the delayed request", async () => {
  await withEditors((browser, first, second) => {
    const moved = requestChatInputFocus();
    second.focus();
    expect(moved.focus(first)).toBe(false);
    const typed = requestChatInputFocus();
    second.dispatchEvent(
      new browser.KeyboardEvent("keydown", {
        key: "a",
        bubbles: true,
      }) as unknown as Event,
    );
    expect(typed.focus(first)).toBe(false);
    expect(document.activeElement === second).toBe(true);
  });
});

test("retired opens, later pointer actions and leaving the browser cannot admit delayed focus", async () => {
  await withEditors((browser, first) => {
    let current = true;
    const retired = requestChatInputFocus(() => current);
    current = false;
    expect(retired.focus(first)).toBe(false);
    const clicked = requestChatInputFocus();
    browser.document.body.dispatchEvent(
      new browser.PointerEvent("pointerdown", { bubbles: true }),
    );
    expect(clicked.focus(first)).toBe(false);
    const blurred = requestChatInputFocus();
    browser.dispatchEvent(new browser.Event("blur"));
    expect(blurred.focus(first)).toBe(false);
  });
});
