import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";

if (process.env.CHAT_COMPOSER_DOM_TEST !== "1") {
  test("Chat reuses the complete composer in an isolated React DOM", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, CHAT_COMPOSER_DOM_TEST: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  }, 15000);
} else {
  test("Chat has the existing palette, isolated draft, Enter send and transactional failure restore", async () => {
    const browser = new Window({ url: "https://world.example.test" });
    const originals = new Map<string, PropertyDescriptor | undefined>();
    for (const [key, value] of Object.entries({
      window: browser,
      document: browser.document,
      navigator: browser.navigator,
      HTMLElement: browser.HTMLElement,
      HTMLButtonElement: browser.HTMLButtonElement,
      HTMLTextAreaElement: browser.HTMLTextAreaElement,
      Element: browser.Element,
      Node: browser.Node,
      localStorage: browser.localStorage,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      });
    }
    const { createRoot } = await import("react-dom/client");
    const { TerminalComposer } = await import("./TerminalComposer");
    const drafts = await import("../terminalComposer");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const chatKey = "chat:alpha:7:terminal-a:session-a";
    const terminalKey = "terminal:alpha:7:terminal-a";
    const sent: string[] = [];
    const errors: string[] = [];
    let pending = Promise.withResolvers<void>();
    drafts.writeTerminalComposerDraft(terminalKey, "terminal draft");
    drafts.writeTerminalComposerDraft(chatKey, "");
    try {
      await act(async () =>
        root.render(
          createElement(TerminalComposer, {
            surface: "chat",
            recipient: "Mira-claude",
            draftKey: chatKey,
            agent: "claude",
            mode: "composer",
            directDisabled: true,
            onModeChange() {},
            onFocusDirect() {},
            shortcutRows: [],
            onRunShortcut() {},
            onClose() {},
            onSubmit: async (text: string) => {
              sent.push(text);
              await pending.promise;
            },
            onUploadImage: async () => "image.png",
            onUploadFile: async () => "file.txt",
            onError: (error: string) => errors.push(error),
          }),
        ),
      );
      expect(host.querySelector('[data-surface="chat"]')).not.toBeNull();
      const textarea = host.querySelector("textarea")!;
      const dispatch = (event: unknown) =>
        textarea.dispatchEvent(event as Event);
      expect(textarea.placeholder).toBe("Message Mira-claude…");
      expect(
        host.querySelector<HTMLButtonElement>(
          '[aria-label="Insert draft into the terminal"]',
        )?.hidden,
      ).toBe(true);
      expect(
        host.querySelector<HTMLButtonElement>(
          '[aria-label="Type directly into the terminal"]',
        )?.hidden,
      ).toBe(true);
      expect(
        host.querySelector(".terminal-composer-shortcuts-toggle"),
      ).toBeNull();
      await act(async () => {
        textarea.focus();
        Object.getOwnPropertyDescriptor(
          browser.HTMLTextAreaElement.prototype,
          "value",
        )!.set!.call(textarea, "/comp");
        dispatch(new browser.Event("input", { bubbles: true }));
      });
      await act(async () => {
        dispatch(
          new browser.KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
        );
      });
      expect(drafts.readTerminalComposerDraft(chatKey)).toBe("/compact ");
      await act(async () => {
        drafts.writeTerminalComposerDraft(chatKey, "/custom.plugin anything");
      });
      await act(async () =>
        dispatch(
          new browser.KeyboardEvent("keydown", {
            key: "Enter",
            isComposing: true,
            bubbles: true,
          }),
        ),
      );
      expect(sent).toEqual([]);
      await act(async () =>
        dispatch(
          new browser.KeyboardEvent("keydown", {
            key: "Enter",
            shiftKey: true,
            bubbles: true,
          }),
        ),
      );
      expect(sent).toEqual([]);
      await act(async () =>
        dispatch(
          new browser.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        ),
      );
      expect(sent).toEqual(["/custom.plugin anything"]);
      expect(drafts.readTerminalComposerDraft(chatKey)).toBe("");
      await act(async () => {
        drafts.writeTerminalComposerDraft(chatKey, " next draft");
        pending.reject(new Error("Agent blocked"));
        await Promise.resolve();
      });
      expect(drafts.readTerminalComposerDraft(chatKey)).toBe(
        "/custom.plugin anything next draft",
      );
      expect(errors).toEqual(["Agent blocked"]);
      expect(drafts.readTerminalComposerDraft(terminalKey)).toBe(
        "terminal draft",
      );
      pending = Promise.withResolvers<void>();
      await act(async () =>
        host.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click(),
      );
      await act(async () => {
        pending.resolve();
        await Promise.resolve();
      });
      expect(drafts.readTerminalComposerDraft(chatKey)).toBe("");
    } finally {
      await act(async () => root.unmount());
      drafts.clearTerminalComposerDraft(chatKey);
      drafts.clearTerminalComposerDraft(terminalKey);
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      }
      await browser.happyDOM.close();
    }
  });
}
