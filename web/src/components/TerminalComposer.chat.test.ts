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
    const { useChatFocusIntent, requestChatInputFocus } = await import(
      "../chatFocus"
    );
    let suppliedFocus: import("../chatFocus").ChatFocusIntent | undefined;
    function OpenChatComposer(
      props: Omit<
        import("react").ComponentProps<typeof ChatComposer>,
        "focusIntent"
      >,
    ) {
      const focusIntent = useChatFocusIntent(
        props.active ?? true,
        suppliedFocus,
      );
      return createElement(ChatComposer, { ...props, focusIntent });
    }
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
    let fingerprint = "session-a";
    let renderedClient = client;
    drafts.writeTerminalComposerDraft(terminalKey, "terminal draft");
    drafts.writeTerminalComposerDraft(chatKey, "");
    const render = (active = true, notice = "") =>
      act(async () =>
        root.render(
          createElement(OpenChatComposer, {
            client: renderedClient,
            pane,
            fingerprint,
            recipient: "Mira-claude",
            active,
            notice,
            onSubmit: async (text: string) => {
              sent.push(text);
              await pending.promise;
            },
            onError: (error: string) => errors.push(error),
          }),
        ),
      );
    const otherInput = document.createElement("input");
    document.body.append(otherInput);
    try {
      otherInput.focus();
      suppliedFocus = requestChatInputFocus();
      await render(false);
      expect(document.activeElement === otherInput).toBe(true);
      await render();
      expect(host.querySelector('[data-surface="chat"]')).not.toBeNull();
      const textarea = host.querySelector("textarea")!;
      expect(document.activeElement === textarea).toBe(true);
      suppliedFocus = undefined;
      await render();
      await act(async () => {
        otherInput.focus();
        drafts.writeTerminalComposerDraft(chatKey, "kept draft");
      });
      await render(true, "Transcript refreshed");
      expect(document.activeElement === otherInput).toBe(true);
      expect(host.querySelector("textarea")).toBe(textarea);
      expect(textarea.value).toBe("kept draft");
      await act(async () => otherInput.focus());
      fingerprint = "session-b";
      await render();
      expect(document.activeElement === otherInput).toBe(true);
      renderedClient = { ...client, serverRuntimeGeneration: 8 };
      await render();
      expect(document.activeElement === otherInput).toBe(true);
      fingerprint = "session-a";
      renderedClient = client;
      await render();
      await render(false);
      await render(false, "Hidden update");
      expect(document.activeElement === otherInput).toBe(true);
      await render(true);
      expect(document.activeElement === textarea).toBe(true);
      expect(host.querySelector("textarea")).toBe(textarea);
      expect(textarea.value).toBe("kept draft");
      // Exercise command browsing from an unfocused editor as before.
      await act(async () => otherInput.focus());
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
      otherInput.remove();
      drafts.clearTerminalComposerDraft(chatKey);
      drafts.clearTerminalComposerDraft(terminalKey);
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      }
      await browser.happyDOM.close();
    }
  });
  test.each([
    "pane",
    "session",
    "terminal",
    "connection",
    "runtime",
    "away-and-back",
  ])(
    "keyed Chat replacement refuses queued files after %s changes but recovers the begun result",
    async (change) => exerciseUploadLifecycle(change),
  );
  test.each(["close-result", "remount-retry", "replaced-owner-retry"])(
    "Chat upload lifecycle preserves %s for the original draft",
    async (change) => exerciseUploadLifecycle(change),
  );
}

async function exerciseUploadLifecycle(change: string) {
  const browser = new Window({ url: "https://world.example.test" });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: browser,
    document: browser.document,
    navigator: browser.navigator,
    HTMLElement: browser.HTMLElement,
    Element: browser.Element,
    Node: browser.Node,
    Event: browser.Event,
    localStorage: browser.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const previousXHR = Object.getOwnPropertyDescriptor(
    globalThis,
    "XMLHttpRequest",
  );
  const { createRoot } = await import("react-dom/client");
  const { ChatComposer, chatComposerDraftKey } = await import(
    "./chat/ChatComposer"
  );
  const { attachmentUploads, retryAttachmentUpload } = await import(
    "../attachmentUploads"
  );
  const drafts = await import("../terminalComposer");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let current = true;
  let client: import("../api").ConnectionClient = {
    connectionId: `lifecycle-${change}`,
    generation: 1,
    serverRuntimeGeneration: 1,
    isCurrent: () => current,
    acceptsServerGeneration: () => current,
    call: async () => undefined,
  };
  let pane: import("../types").Pane = {
    pane_id: "pane-a",
    terminal_id: "terminal-a",
    workspace_id: "synthetic",
    tab_id: "tab-a",
    focused: true,
    agent_status: "idle",
    revision: 1,
  };
  let fingerprint = "a".repeat(64);
  const originalKey = chatComposerDraftKey(client, pane, fingerprint);
  const originalClient = client;
  drafts.activateTerminalComposerDraftScope(client.connectionId, 1);
  const requests: {
    name: string;
    generation: string | null;
    xhr: FixtureXHR;
  }[] = [];
  const errors: string[] = [];
  const sends: string[] = [];
  class FixtureXHR {
    upload = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    responseType = "";
    response: Blob | null = null;
    status = 200;
    statusText = "OK";
    url = new URL(browser.location.origin);
    open(_method: string, url: URL) {
      this.url = new URL(String(url));
    }
    setRequestHeader() {}
    getAllResponseHeaders() {
      return `X-Herdr-Connection-Id: ${originalClient.connectionId}\r\nX-Herdr-Connection-Generation: 1\r\nContent-Type: application/json\r\n`;
    }
    send() {
      const name = this.url.searchParams.get("filename")!;
      requests.push({
        name,
        generation: this.url.searchParams.get("connection_generation"),
        xhr: this,
      });
      this.response = new Blob([
        JSON.stringify({ path: `/synthetic/${name}` }),
      ]);
      if (requests.length > 1) queueMicrotask(() => this.onload?.());
    }
  }
  Object.defineProperty(globalThis, "XMLHttpRequest", {
    configurable: true,
    writable: true,
    value: FixtureXHR,
  });
  const render = async () =>
    act(async () =>
      root.render(
        createElement(ChatComposer, {
          key: JSON.stringify([
            client.connectionId,
            client.serverRuntimeGeneration,
            pane.terminal_id,
            pane.pane_id,
            fingerprint,
          ]),
          client,
          pane,
          fingerprint,
          recipient: "synthetic",
          notice: "",
          focusIntent: null,
          onSubmit: async (text: string) => {
            sends.push(text);
          },
          onError: (text: string) => errors.push(text),
        }),
      ),
    );
  const close = async () => act(async () => root.render(createElement("div")));
  try {
    await render();
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Add a file"]')!
        .click(),
    );
    const count =
      change === "close-result" || change === "remount-retry" ? 1 : 6;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: Array.from(
        { length: count },
        (_, i) =>
          new browser.File(["synthetic"], `file-${i + 1}.png`, {
            type: "image/png",
          }),
      ),
    });
    await act(async () =>
      input.dispatchEvent(
        new browser.Event("change", { bubbles: true }) as unknown as Event,
      ),
    );
    expect(requests.map((r) => r.name)).toEqual(["file-1.png"]);
    if (change === "remount-retry") {
      requests[0].xhr.status = 507;
      requests[0].xhr.response = new Blob([
        JSON.stringify({ error: "synthetic failure" }),
      ]);
      await act(async () => requests[0].xhr.onload?.());
      expect(
        container.querySelector<HTMLElement>(".attachment-chip")?.dataset
          .status,
      ).toBe("failed");
      await close();
      current = false;
      client = {
        ...client,
        generation: 2,
        isCurrent: () => true,
        acceptsServerGeneration: () => true,
      };
      await render();
      expect(requests).toHaveLength(1);
      await act(async () =>
        container.querySelector<HTMLButtonElement>('[title="Retry"]')!.click(),
      );
      expect(requests.map((r) => r.name)).toEqual(["file-1.png", "file-1.png"]);
      expect(requests[1].generation).toBe("1");
      expect(container.querySelector("textarea")!.value).toContain(
        "/synthetic/file-1.png",
      );
    } else {
      if (change === "close-result") await close();
      else {
        if (
          change === "pane" ||
          change === "away-and-back" ||
          change === "replaced-owner-retry"
        )
          pane = { ...pane, pane_id: "pane-b" };
        if (change === "session") fingerprint = "b".repeat(64);
        if (change === "terminal")
          pane = { ...pane, terminal_id: "terminal-b" };
        if (change === "connection")
          client = { ...client, connectionId: "other-connection" };
        if (change === "runtime")
          client = { ...client, serverRuntimeGeneration: 2 };
        await render();
        if (change === "away-and-back") {
          pane = { ...pane, pane_id: "pane-a" };
          await render();
        }
      }
      await act(async () => requests[0].xhr.onload?.());
      expect(requests).toHaveLength(1);
      expect(drafts.readTerminalComposerDraft(originalKey)).toContain(
        "/synthetic/file-1.png",
      );
      if (change === "close-result") await render();
      const nextKey = chatComposerDraftKey(client, pane, fingerprint);
      if (nextKey !== originalKey) {
        expect(drafts.readTerminalComposerDraft(nextKey)).toBe("");
        const failed = attachmentUploads(originalKey).find(
          (upload) => upload.status === "failed",
        )!;
        await act(async () => retryAttachmentUpload(originalKey, failed.id));
        expect(requests).toHaveLength(1);
      } else
        expect(container.querySelector("textarea")!.value).toContain(
          "/synthetic/file-1.png",
        );
      if (change === "replaced-owner-retry") {
        pane = { ...pane, pane_id: "pane-a" };
        current = false;
        client = {
          ...client,
          generation: 2,
          isCurrent: () => true,
          acceptsServerGeneration: () => true,
        };
        await render();
        expect(requests).toHaveLength(1);
        await act(async () =>
          container
            .querySelector<HTMLButtonElement>(
              '[aria-label="Retry file-2.png"]',
            )!
            .click(),
        );
        expect(requests.map((request) => request.name)).toEqual([
          "file-1.png",
          "file-2.png",
        ]);
        expect(drafts.readTerminalComposerDraft(originalKey)).toContain(
          "/synthetic/file-2.png",
        );
      }
    }
    expect(sends).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    if (previousXHR)
      Object.defineProperty(globalThis, "XMLHttpRequest", previousXHR);
    else delete (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    await browser.happyDOM.close();
  }
}
