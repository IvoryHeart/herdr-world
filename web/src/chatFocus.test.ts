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

test("removing the explicit opener keeps the body's passive fallback valid", async () => {
  await withEditors((browser, first) => {
    const opener = browser.document.createElement("button");
    opener.textContent = "Open chat";
    browser.document.body.append(opener);
    opener.focus();
    const intent = requestChatInputFocus();
    opener.remove();
    expect(document.activeElement === document.body).toBe(true);
    expect(intent.focus(first)).toBe(true);
    expect(document.activeElement === first).toBe(true);
  });
});

test("blurring a connected opener does not authorize a body-focus fallback", async () => {
  await withEditors((browser, first) => {
    const opener = browser.document.createElement("button");
    browser.document.body.append(opener);
    opener.focus();
    const intent = requestChatInputFocus();
    opener.blur();
    expect(opener.isConnected).toBe(true);
    expect(document.activeElement === document.body).toBe(true);
    expect(intent.focus(first)).toBe(false);
    expect(document.activeElement === document.body).toBe(true);
  });
});

test("opener removal never excuses a later focus choice or user input", async () => {
  await withEditors((browser, first, second) => {
    for (const action of ["focus", "key", "pointer"] as const) {
      const opener = browser.document.createElement("button");
      browser.document.body.append(opener);
      opener.focus();
      const intent = requestChatInputFocus();
      opener.remove();
      if (action === "focus") second.focus();
      else
        document.body.dispatchEvent(
          action === "key"
            ? (new browser.KeyboardEvent("keydown", {
                key: "j",
                bubbles: true,
              }) as unknown as Event)
            : (new browser.PointerEvent("pointerdown", {
                bubbles: true,
              }) as unknown as Event),
        );
      expect(intent.focus(first)).toBe(false);
    }
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
