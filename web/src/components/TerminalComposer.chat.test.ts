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
  test("Chat has the existing palette, isolated draft, modified Enter send and transactional failure restore", async () => {
    const browser = new Window({ url: "https://world.example.test" });
    const originals = new Map<string, PropertyDescriptor | undefined>();
    for (const [key, value] of Object.entries({
      window: browser,
      document: browser.document,
      navigator: browser.navigator,
      HTMLElement: browser.HTMLElement,
      HTMLButtonElement: browser.HTMLButtonElement,
      HTMLTextAreaElement: browser.HTMLTextAreaElement,
      HTMLInputElement: browser.HTMLInputElement,
      Element: browser.Element,
      Node: browser.Node,
      NodeFilter: browser.NodeFilter,
      MutationObserver: browser.MutationObserver,
      CustomEvent: browser.CustomEvent,
      getComputedStyle: browser.getComputedStyle.bind(browser),
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
    const { closeTopLayer, openLayerCount } = await import("../layerStack");
    const { ChatComposer, chatComposerDraftKey } = await import(
      "./chat/ChatComposer"
    );
    const drafts = await import("../terminalComposer");
    // Exercise App admission before mounting the real Chat wrapper.
    {
      const pane = {
        terminal_id: "terminal-a",
        pane_id: "pane-a",
      } as import("../types").Pane;
      const client = {
        connectionId: "scope-host",
        generation: 19,
        serverRuntimeGeneration: 7,
      } as import("../api").ConnectionClient;
      for (const runtime of [7, null]) {
        const owner = { ...client, serverRuntimeGeneration: runtime };
        const generation = runtime ?? owner.generation;
        drafts.activateTerminalComposerDraftScope(
          owner.connectionId,
          generation,
        );
        const key = chatComposerDraftKey(owner, pane, "session-a");
        drafts.writeTerminalComposerDraft(key, "current draft");
        expect(drafts.readTerminalComposerDraft(key)).toBe("current draft");
        expect(drafts.beginTerminalComposerSubmission(key)).toBe(true);
        expect(drafts.beginTerminalComposerUpload(key)).toBe(true);
        for (const other of [
          chatComposerDraftKey(owner, pane, "session-b"),
          chatComposerDraftKey(
            owner,
            { ...pane, terminal_id: "terminal-b" },
            "session-a",
          ),
          chatComposerDraftKey(
            owner,
            { ...pane, pane_id: "pane-b" },
            "session-a",
          ),
          drafts.terminalComposerDraftKey(
            owner.connectionId,
            generation,
            pane.pane_id,
          ),
        ])
          expect(drafts.readTerminalComposerDraft(other)).toBe("");

        drafts.activateTerminalComposerDraftScope(
          owner.connectionId,
          generation + 1,
        );
        expect(drafts.readTerminalComposerDraft(key)).toBe("");
        expect(drafts.beginTerminalComposerSubmission(key)).toBe(false);
        expect(drafts.beginTerminalComposerUpload(key)).toBe(false);
        drafts.insertIntoTerminalComposerDraft(key, "/uploads/late.png");
        expect(drafts.readTerminalComposerDraft(key)).toBe("");
      }
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    // App retains all managed runtime scopes, including an Inspector whose
    // host is not the focused Spaces host. Its browser lease is a separate epoch.
    const client = {
      connectionId: "alpha",
      generation: 19,
      serverRuntimeGeneration: 7,
      isCurrent: () => true,
      acceptsServerGeneration: (value: unknown) => value === 7,
      call: async () => ({}),
    };
    const pane = {
      terminal_id: "terminal-a",
      pane_id: "pane-a",
      agent: "claude",
    } as import("../types").Pane;
    const chatKey = chatComposerDraftKey(client, pane, "session-a");
    const terminalKey = drafts.terminalComposerDraftKey("alpha", 7, "pane-a");
    drafts.activateTerminalComposerDraftScope("spaces", 3, [
      { connectionId: "alpha", connectionGeneration: 7 },
    ]);
    const sent: string[] = [];
    const errors: string[] = [];
    let pending = Promise.withResolvers<void>();
    drafts.writeTerminalComposerDraft(terminalKey, "terminal draft");
    drafts.writeTerminalComposerDraft(chatKey, "");
    try {
      await act(async () =>
        root.render(
          createElement(ChatComposer, {
            client,
            pane,
            fingerprint: "session-a",
            recipient: "Mira-claude",
            notice: "",
            onSubmit: async (text: string) => {
              sent.push(text);
              await pending.promise;
            },
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
      expect(
        host.querySelector<HTMLButtonElement>(
          ".terminal-composer-commands-toggle",
        )?.hidden,
      ).toBe(true);
      await act(async () => {
        drafts.writeTerminalComposerDraft(chatKey, "back-safe draft");
      });
      await act(async () => {
        host
          .querySelector<HTMLButtonElement>(
            '[aria-label="More composer controls"]',
          )!
          .click();
      });
      const browseCommands = Array.from(
        browser.document.querySelectorAll("button"),
      ).find((button) => button.textContent?.includes("Browse commands"));
      expect(browseCommands).toBeDefined();
      expect(openLayerCount()).toBe(1);
      await act(async () => {
        expect(closeTopLayer()).toBe(true);
      });
      expect(openLayerCount()).toBe(0);
      expect(document.querySelector(".chat-composer-tools-popover")).toBeNull();
      expect(host.querySelector("textarea")).toBe(textarea);
      expect(drafts.readTerminalComposerDraft(chatKey)).toBe("back-safe draft");
      expect(sent).toEqual([]);
      await act(async () => {
        host
          .querySelector<HTMLButtonElement>(
            '[aria-label="More composer controls"]',
          )!
          .click();
      });
      await act(async () => {
        Array.from(browser.document.querySelectorAll("button"))
          .find((button) => button.textContent?.includes("Browse commands"))!
          .click();
      });
      expect(textarea.getAttribute("aria-expanded")).toBe("true");
      expect(document.activeElement?.getAttribute("aria-label")).toBe(
        "Agent commands",
      );
      await act(async () =>
        dispatch(
          new browser.KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
          }),
        ),
      );
      await act(async () => {
        textarea.focus();
        Object.getOwnPropertyDescriptor(
          browser.HTMLTextAreaElement.prototype,
          "value",
        )!.set!.call(textarea, "/comp");
        dispatch(new browser.Event("input", { bubbles: true }));
      });
      expect(textarea.getAttribute("aria-expanded")).toBe("true");
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
      expect(sent).toEqual([]);
      await act(async () =>
        dispatch(
          new browser.KeyboardEvent("keydown", {
            key: "Enter",
            ctrlKey: true,
            bubbles: true,
          }),
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
      await act(async () => {
        drafts.writeTerminalComposerDraft(chatKey, "Mac send");
      });
      await act(async () =>
        dispatch(
          new browser.KeyboardEvent("keydown", {
            key: "Enter",
            metaKey: true,
            bubbles: true,
          }),
        ),
      );
      expect(sent[sent.length - 1]).toBe("Mac send");
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
