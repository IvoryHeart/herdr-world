import { afterAll, afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { Root } from "react-dom/client";
import * as drafts from "../terminalComposer";
import { defaultMobileTerminalShortcutRows } from "../mobileTerminalShortcuts";
import type { ComposerUpload, TerminalInputMode } from "./TerminalComposer";
import type { ConnectionClient } from "../api";
import type { Pane } from "../types";
import { uploadTerminalFile } from "../terminalImageUpload";

// Use real React commits: hook spies cannot reproduce batched completions or
// the browser moving a hidden controlled textarea's selection on value changes.
if (process.env.HERDR_WORLD_COMPOSER_UPLOAD_DOM_TEST !== "1") {
  test("composer upload regressions in an isolated runtime", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, HERDR_WORLD_COMPOSER_UPLOAD_DOM_TEST: "1" },
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
  }, 15_000);
} else {
  await registerDomTests();
}

async function registerDomTests() {
  const browser = new Window({ url: "http://localhost" });
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
    sessionStorage: browser.sessionStorage,
    requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
    cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
  }
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { TerminalComposer } = await import("./TerminalComposer");
  const { chatComposerDraftKey } = await import("./chat/ChatComposer");
  let root: Root | null = null;
  let container: HTMLDivElement;
  let serial = 0;
  const originalFetch = globalThis.fetch;
  afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (root) await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();
    document.documentElement.classList.remove("keyboard-open");
    await browser.happyDOM.whenAsyncComplete();
  });
  afterAll(async () => {
    await browser.happyDOM.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  function deferred() {
    let resolve!: (path: string) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<string>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    return { promise, resolve, reject };
  }

  async function mount(
    text = "left SELECT right",
    start = 5,
    end = 11,
    shortcuts = false,
    agent?: string,
    surface: "terminal" | "chat" = "terminal",
  ) {
    const connection = `upload-dom-${++serial}`;
    drafts.activateTerminalComposerDraftScope(connection, 1);
    const key = drafts.terminalComposerDraftKey(connection, 1, "pane-a");
    drafts.writeTerminalComposerDraft(key, text);
    drafts.writeTerminalComposerSelection(key, start, end);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const uploads: ReturnType<typeof deferred>[] = [];
    const errors: string[] = [];
    const sent: string[] = [];
    const directInput = document.createElement("button");
    document.body.append(directInput);
    let mode: TerminalInputMode = "composer";
    let activeKey = key;
    const progress: ((loaded: number, total: number) => void)[] = [];
    const upload = (
      _file: File,
      onProgress?: (l: number, t: number) => void,
    ) => {
      const pending = deferred();
      uploads.push(pending);
      progress.push(onProgress ?? (() => {}));
      return pending.promise;
    };
    let fileUpload: ComposerUpload = upload;
    let pathInsertion: (() => (text: string) => Promise<void>) | undefined;
    const render = () =>
      root!.render(
        createElement(TerminalComposer, {
          surface,
          draftKey: activeKey,
          mode,
          onModeChange: (next) => {
            mode = next;
            render();
          },
          onFocusDirect: () => directInput.focus(),
          directDisabled: false,
          agent,
          shortcutRows: shortcuts ? defaultMobileTerminalShortcutRows() : [],
          onRunShortcut: () => {},
          onClose: () => {},
          onSubmit: async (value) => {
            sent.push(value);
          },
          onUploadImage: upload,
          onUploadFile: fileUpload,
          onPreparePathInsertion: pathInsertion,
          onError: (message) => errors.push(message),
        }),
      );
    await act(async () => render());
    const textarea = () => container.querySelector("textarea")!;
    let pasted = 0;
    // Each paste is a different file; the same file again is a duplicate.
    const paste = async (name = `a${++pasted}.png`) => {
      await act(async () => {
        const event = new browser.Event("paste", {
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperty(event, "clipboardData", {
          value: {
            items: [
              {
                kind: "file",
                type: "image/png",
                getAsFile: () =>
                  new browser.File(["x"], name, {
                    type: "image/png",
                    lastModified: 1,
                  }),
              },
            ],
          },
        });
        textarea().dispatchEvent(event as unknown as Event);
      });
    };
    const setMode = async (next: TerminalInputMode) => {
      await act(async () => {
        mode = next;
        render();
        if (next === "direct") directInput.focus();
      });
    };
    const select = async (start: number, end = start) => {
      await act(async () => {
        textarea().focus();
        textarea().setSelectionRange(start, end);
        textarea().dispatchEvent(
          new browser.KeyboardEvent("keyup", {
            key: "ArrowLeft",
            bubbles: true,
          }) as unknown as KeyboardEvent,
        );
      });
    };
    const edit = async (value: string, caret: number) => {
      await act(async () => {
        textarea().focus();
        // Bypass React's value tracker just as native typing does.
        Object.getOwnPropertyDescriptor(
          browser.HTMLTextAreaElement.prototype,
          "value",
        )!.set!.call(textarea(), value);
        textarea().setSelectionRange(caret, caret);
        textarea().dispatchEvent(
          new browser.Event("input", { bubbles: true }) as unknown as Event,
        );
      });
    };
    const remount = async () => {
      await act(async () => root!.unmount());
      root = createRoot(container);
      await act(async () => render());
    };
    const switchDraft = async (next: string) => {
      activeKey = next;
      await act(async () => render());
    };
    const replaceFileUpload = async (next: ComposerUpload) => {
      fileUpload = next;
      await act(async () => render());
    };
    const replacePathInsertion = async (
      next: () => (text: string) => Promise<void>,
    ) => {
      pathInsertion = next;
      await act(async () => render());
    };
    return {
      key,
      connection,
      uploads,
      progress,
      container,
      errors,
      sent,
      textarea,
      paste,
      setMode,
      select,
      edit,
      remount,
      switchDraft,
      replaceFileUpload,
      replacePathInsertion,
      directInput,
    };
  }

  function expanded() {
    return container
      .querySelector(".terminal-composer")!
      .hasAttribute("data-expanded");
  }

  function pointer(target: Element) {
    target.dispatchEvent(
      new browser.PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerType: "touch",
      }) as unknown as PointerEvent,
    );
  }

  async function pickerHarness(pauseAfterFirstInsertion = false) {
    const h = await mount("", 0, 0, false, undefined, "chat");
    let current = true;
    const client = {
      connectionId: h.connection,
      generation: 1,
      serverRuntimeGeneration: 1,
      isCurrent: () => current,
      acceptsServerGeneration: () => current,
      call: async () => undefined,
    } satisfies ConnectionClient;
    const pane: Pane = {
      pane_id: "pane-a",
      terminal_id: "terminal-a",
      workspace_id: "synthetic",
      tab_id: "tab-a",
      focused: true,
      agent_status: "idle",
      revision: 1,
    };
    const fingerprint = "a".repeat(64);
    const key = chatComposerDraftKey(client, pane, fingerprint);
    await h.switchDraft(key);
    const requests: string[] = [];
    const dispatchedGenerations: number[] = [];
    globalThis.fetch = (async (url) => {
      requests.push(String(url));
      const name = new URL(String(url)).searchParams.get("filename");
      return Response.json(
        { path: `/synthetic/${name}` },
        {
          headers: {
            "X-Herdr-Connection-Id": client.connectionId,
            "X-Herdr-Connection-Generation": "1",
          },
        },
      );
    }) as typeof fetch;
    const bind =
      (owner: ConnectionClient): ComposerUpload =>
      (file) => {
        dispatchedGenerations.push(owner.generation);
        return uploadTerminalFile(owner, file);
      };
    await h.replaceFileUpload(bind(client));
    const firstInserted = Promise.withResolvers<void>();
    const continueBatch = Promise.withResolvers<void>();
    let paused = false;
    if (pauseAfterFirstInsertion) {
      await h.replacePathInsertion(() => async (text) => {
        drafts.insertIntoTerminalComposerDraft(key, text);
        if (!paused) {
          paused = true;
          firstInserted.resolve();
          await continueBatch.promise;
        }
      });
    }
    const input =
      h.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () =>
      h.container
        .querySelector<HTMLButtonElement>('[aria-label="Add a file"]')!
        .click(),
    );
    const choose = async (
      files = [
        new browser.File(["synthetic"], "owned.png", { type: "image/png" }),
      ],
    ) => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: files,
      });
      await act(async () =>
        input.dispatchEvent(
          new browser.Event("change", { bubbles: true }) as unknown as Event,
        ),
      );
    };
    const reconnect = async () => {
      current = false;
      await h.replaceFileUpload(
        bind({ ...client, generation: 2, isCurrent: () => true }),
      );
    };
    return {
      ...h,
      key,
      client,
      pane,
      fingerprint,
      requests,
      dispatchedGenerations,
      firstInserted: firstInserted.promise,
      continueBatch: () => act(async () => continueBatch.resolve()),
      replaceClient: (owner: ConnectionClient) =>
        h.replaceFileUpload(bind(owner)),
      choose,
      reconnect,
      retire: () => {
        current = false;
      },
    };
  }

  test("normal paperclip upload uses its qualified client and inserts the acknowledged path without sending", async () => {
    const h = await pickerHarness();
    await h.choose();
    expect(h.requests).toHaveLength(1);
    const request = new URL(h.requests[0]);
    expect(request.pathname).toBe(
      `/api/connections/${h.connection}/terminal-upload`,
    );
    expect(request.searchParams.get("connection_generation")).toBe("1");
    expect(h.textarea().value).toContain("/synthetic/owned.png");
    expect(h.sent).toEqual([]);
    expect(h.errors).toEqual([]);
  });

  test("an open paperclip chooser uses the fresh same-owner upload client after a transport reconnect", async () => {
    const h = await pickerHarness();
    await h.reconnect();
    await h.choose();
    expect(h.requests).toHaveLength(1);
    expect(h.textarea().value).toContain("/synthetic/owned.png");
    expect(h.sent).toEqual([]);
    expect(h.errors).toEqual([]);
  });

  test.each(["connection", "runtime", "pane", "session", "away-and-back"])(
    "an open paperclip chooser refuses a changed %s owner without uploading or redirecting the file",
    async (change) => {
      const h = await pickerHarness();
      const next = chatComposerDraftKey(
        change === "connection"
          ? { ...h.client, connectionId: "other-connection" }
          : change === "runtime"
            ? { ...h.client, serverRuntimeGeneration: 2 }
            : h.client,
        change === "pane" || change === "away-and-back"
          ? { ...h.pane, pane_id: "pane-b" }
          : h.pane,
        change === "session" ? "b".repeat(64) : h.fingerprint,
      );
      await h.switchDraft(next);
      if (change === "away-and-back") await h.switchDraft(h.key);
      await h.choose();
      expect(h.requests).toHaveLength(0);
      expect(h.errors).toContain("Upload target changed while choosing files");
      expect(h.textarea().value).toBe("");
      expect(h.sent).toEqual([]);
    },
  );

  test("an open chooser with no current replacement still refuses its retired client before uploading", async () => {
    const h = await pickerHarness();
    h.retire();
    await h.choose();
    expect(h.requests).toHaveLength(0);
    expect(h.errors).toEqual(["connection changed during upload"]);
    expect(
      h.container.querySelector<HTMLElement>(".attachment-chip")?.dataset
        .status,
    ).toBe("failed");
    expect(h.textarea().value).toBe("");
  });

  const sixFiles = () =>
    [1, 2, 3, 1, 2, 3].map(
      (size, index) =>
        new browser.File(
          [new Uint8Array(size * 1024 * 1024)],
          `file-${index + 1}.png`,
          { type: "image/png" },
        ),
    );

  test.each([false, true])(
    "six selected files keep their qualified owner and all insert, reconnect after first acknowledgement/insertion=%s",
    async (reconnect) => {
      const h = await pickerHarness(true);
      const files = sixFiles();
      await h.choose(files);
      await h.firstInserted;
      expect(h.requests).toHaveLength(1);
      expect(h.textarea().value).toContain("/synthetic/file-1.png");
      if (reconnect) await h.reconnect();
      await h.continueBatch();
      expect(h.requests).toHaveLength(6);
      expect(h.dispatchedGenerations).toEqual(
        reconnect ? [1, 2, 2, 2, 2, 2] : [1, 1, 1, 1, 1, 1],
      );
      for (const [index, url] of h.requests.entries()) {
        const request = new URL(url);
        expect(request.pathname).toBe(
          `/api/connections/${h.connection}/terminal-upload`,
        );
        expect(request.searchParams.get("connection_generation")).toBe("1");
        expect(request.searchParams.get("filename")).toBe(files[index].name);
        expect(h.textarea().value).toContain(`/synthetic/${files[index].name}`);
      }
      expect(h.sent).toEqual([]);
      expect(h.errors).toEqual([]);
    },
  );

  test.each(["connection", "runtime", "pane", "session", "away-and-back"])(
    "queued files refuse a changed %s after file one succeeds, retaining its original path",
    async (change) => {
      const h = await pickerHarness(true);
      await h.choose(sixFiles());
      await h.firstInserted;
      const client = {
        ...h.client,
        generation: 2,
        connectionId:
          change === "connection" ? "other-connection" : h.connection,
        serverRuntimeGeneration: change === "runtime" ? 2 : 1,
        isCurrent: () => true,
      };
      const next = chatComposerDraftKey(
        client,
        change === "pane" || change === "away-and-back"
          ? { ...h.pane, pane_id: "pane-b" }
          : h.pane,
        change === "session" ? "b".repeat(64) : h.fingerprint,
      );
      h.retire();
      await h.switchDraft(next);
      await h.replaceClient(client);
      if (change === "away-and-back") await h.switchDraft(h.key);
      await h.continueBatch();
      expect(h.requests).toHaveLength(1);
      expect(h.dispatchedGenerations).toEqual([1]);
      expect(h.errors).toEqual(
        Array(5).fill("Upload target changed during upload"),
      );
      expect(drafts.readTerminalComposerDraft(h.key)).toContain(
        "/synthetic/file-1.png",
      );
      if (change !== "away-and-back") expect(h.textarea().value).toBe("");
      expect(h.sent).toEqual([]);
    },
  );

  test("only focused multiline drafts expand, blur folds without losing caret, and refocus remeasures", async () => {
    const h = await mount("one\ntwo", 2, 2);
    expect(expanded()).toBe(false);
    const editor = h.textarea();
    await h.select(2);
    expect(expanded()).toBe(true);
    await act(async () => h.directInput.focus()); // native Tab focus transfer
    expect(expanded()).toBe(false);
    expect(h.textarea()).toBe(editor);
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 2]);
    expect(drafts.readTerminalComposerDraft(h.key)).toBe("one\ntwo");
    await h.select(2);
    expect(expanded()).toBe(true);
    await h.edit("one", 2); // session latch, no width/height oscillation
    expect(expanded()).toBe(true);
    await act(async () => editor.blur());
    expect(expanded()).toBe(false);
    await h.select(2);
    expect(expanded()).toBe(false);
  });

  test("visual soft wrapping expands once even when the wider editor fits one row", async () => {
    const h = await mount("a visually wrapping draft", 3, 3);
    const editor = h.textarea();
    editor.style.lineHeight = "22px";
    editor.style.padding = "12px";
    let wrapped = true;
    Object.defineProperty(editor, "scrollHeight", {
      configurable: true,
      get: () => (wrapped && !expanded() ? 68 : 46),
    });
    await h.select(3);
    expect(expanded()).toBe(true);
    await act(async () => editor.blur());
    expect(expanded()).toBe(false);
    wrapped = false;
    await h.select(3);
    expect(expanded()).toBe(false);
  });

  test("terminal pointer prevention ends editing but textarea gestures and composition stay native", async () => {
    const h = await mount("one\ntwo", 2, 2);
    await h.select(2);
    await act(async () => {
      h.textarea().dispatchEvent(
        new browser.CompositionEvent("compositionstart", {
          bubbles: true,
        }) as unknown as Event,
      );
      pointer(h.textarea());
    });
    expect(document.activeElement).toBe(h.textarea());
    expect(expanded()).toBe(true);
    await act(async () => {
      h.textarea().dispatchEvent(
        new browser.CompositionEvent("compositionend", {
          bubbles: true,
        }) as unknown as Event,
      );
      h.directInput.addEventListener("pointerdown", (event) =>
        event.preventDefault(),
      );
      pointer(h.directInput);
    });
    expect(document.activeElement).not.toBe(h.textarea());
    expect(expanded()).toBe(false);
    expect(h.textarea().value).toBe("one\ntwo");
  });

  test.each([
    "Insert draft into the terminal",
    "Send draft to the terminal",
    "Add a file",
    "Commands",
  ])(
    "%s survives touch blur before click without moving or unmounting its target",
    async (label) => {
      const h = await mount("one\ntwo", 2, 2, false, "codex");
      await h.select(2);
      const tool = container.querySelector<HTMLButtonElement>(
        `[aria-label="${label}"]`,
      )!;
      let pickerClicks = 0;
      container
        .querySelector('input[type="file"]')!
        .addEventListener("click", () => pickerClicks++);
      await act(async () => {
        pointer(tool);
        h.textarea().blur(); // native touch focus/file picker transition
      });
      expect(expanded()).toBe(true); // keep the hit target's geometry until click
      expect(tool.isConnected).toBe(true);
      await act(async () => tool.click());
      expect(expanded()).toBe(false);
      expect(document.activeElement).not.toBe(h.textarea());
      if (label.startsWith("Insert") || label.startsWith("Send")) {
        expect(h.sent).toEqual(["one\ntwo"]);
      } else {
        expect(h.textarea().value).toBe("one\ntwo");
        if (label === "Add a file") expect(pickerClicks).toBe(1);
        else
          expect(
            container.querySelector(".terminal-composer-commands"),
          ).not.toBeNull();
      }
    },
  );

  test("dock actions and async completions leave the editor blurred", async () => {
    const h = await mount("left SELECT right", 5, 11, true);
    const dock = container.querySelector<HTMLElement>(".terminal-composer")!;
    await act(async () => dock.focus());
    expect(document.activeElement).toBe(dock);
    await h.setMode("direct");
    expect(document.activeElement).toBe(h.directInput);
    await h.setMode("composer");
    expect(document.activeElement).not.toBe(h.textarea());

    await h.select(5, 11);
    await h.paste();
    const shortcut = container.querySelector<HTMLButtonElement>(
      ".terminal-composer-shortcuts button",
    )!;
    const touch = (target: Element) =>
      target.dispatchEvent(
        new browser.PointerEvent("pointerdown", {
          bubbles: true,
          pointerType: "touch",
        }) as unknown as PointerEvent,
      );
    document.documentElement.classList.add("keyboard-open");
    await act(async () => touch(shortcut));
    expect(document.activeElement).toBe(h.textarea());
    document.documentElement.classList.remove("keyboard-open");
    await act(async () => touch(h.textarea()));
    expect(document.activeElement).toBe(h.textarea());
    await act(async () => touch(h.directInput));
    expect(document.activeElement).not.toBe(h.textarea());
    await h.select(5, 11);
    await act(async () => touch(shortcut));
    expect(document.activeElement).not.toBe(h.textarea());
    await act(async () => {
      dock.focus();
      dock.dispatchEvent(
        new browser.Event("scroll", {
          bubbles: true,
        }) as unknown as Event,
      );
      shortcut.click();
    });
    expect(document.activeElement).toBe(dock);
    await act(async () => h.uploads[0].resolve("/A.png"));
    expect(document.activeElement).toBe(dock);
    expect(h.textarea().value).toBe("left /A.png  right");
    expect([h.textarea().selectionStart, h.textarea().selectionEnd]).toEqual([
      12, 12,
    ]);

    const send = container.querySelector<HTMLButtonElement>(
      '[aria-label="Send draft to the terminal"]',
    )!;
    await act(async () => {
      send.focus();
      send.click();
    });
    expect(h.sent).toEqual(["left /A.png  right"]);
    expect(document.activeElement).not.toBe(h.textarea());
    await h.select(0);
    expect(document.activeElement).toBe(h.textarea());
  });

  test("commands preserve active editing and otherwise return focus to Commands", async () => {
    const h = await mount("", 0, 0, false, "codex");
    const commands = container.querySelector<HTMLButtonElement>(
      ".terminal-composer-commands-toggle",
    )!;
    await act(async () => commands.click());
    expect(document.activeElement).toBe(
      container.querySelector(".terminal-composer-commands"),
    );
    const chooseFirst = () =>
      container
        .querySelector<HTMLButtonElement>(
          ".terminal-composer-command-list button",
        )!
        .click();
    await act(async () => chooseFirst());
    expect(h.textarea().value).toBe("/model ");
    expect([h.textarea().selectionStart, h.textarea().selectionEnd]).toEqual([
      7, 7,
    ]);
    expect(document.activeElement).toBe(commands);

    await h.edit("/", 1);
    await act(async () => chooseFirst());
    expect(h.textarea().value).toBe("/model ");
    expect(document.activeElement).toBe(h.textarea());
    expect([h.textarea().selectionStart, h.textarea().selectionEnd]).toEqual([
      7, 7,
    ]);
    expect(h.sent).toEqual([]);
  });

  test("legacy other-tab shortcut visibility changes cannot hide keys or disturb the active draft", async () => {
    const key = "herdr-world:foundation-v2:terminalComposerShortcutsOpen.v1";
    browser.localStorage.removeItem(key);
    const h = await mount("left SELECT right", 5, 11, true);
    await h.select(5, 11);
    const editor = h.textarea();
    const panel = () =>
      container.querySelector<HTMLElement>(".terminal-composer-shortcuts")!;
    const change = async (value: string | null) => {
      if (value === null) browser.localStorage.removeItem(key);
      else browser.localStorage.setItem(key, value);
      await act(async () => {
        const event = new browser.StorageEvent("storage", {
          key,
          newValue: value ?? undefined,
          storageArea: browser.localStorage,
        });
        Object.defineProperty(event, "newValue", { value });
        browser.dispatchEvent(event);
      });
    };
    expect(panel().hidden).toBe(false);
    await change("false");
    expect(panel().hidden).toBe(false);
    expect(h.textarea()).toBe(editor);
    expect(document.activeElement).toBe(editor);
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([5, 11]);
    expect(drafts.readTerminalComposerDraft(h.key)).toBe("left SELECT right");
    expect(h.sent).toEqual([]);
    await change(null);
    expect(panel().hidden).toBe(false);
  });

  for (const mode of ["composer", "direct"] as const) {
    for (const batched of [false, true]) {
      test(`${mode}: ${batched ? "batched" : "separate"} uploads retain both paths and the unselected suffix`, async () => {
        const h = await mount("left REALLY_LONG_SELECTED_SPAN right", 5, 30);
        await h.paste();
        await h.paste();
        await h.setMode(mode);
        if (batched) {
          await act(async () => {
            h.uploads[0].resolve("/A.png");
            h.uploads[1].resolve("/B.png");
          });
        } else {
          await act(async () => h.uploads[0].resolve("/A.png"));
          await act(async () => h.uploads[1].resolve("/B.png"));
        }
        expect(drafts.readTerminalComposerDraft(h.key)).toBe(
          "left /A.png /B.png  right",
        );
        expect(drafts.readTerminalComposerSelection(h.key)).toEqual({
          start: 19,
          end: 19,
        });
        expect(drafts.terminalComposerUploadCount(h.key)).toBe(0);
        if (mode === "direct")
          expect(document.activeElement).toBe(h.directInput);
        await h.setMode("composer");
        expect(h.textarea().selectionStart).toBe(19);
        expect(h.sent).toEqual([]);
      });
    }
  }

  test("a stale selection event before React commits cannot roll back an inserted caret", async () => {
    const h = await mount();
    await h.select(5, 11);
    await h.paste();
    await h.paste();
    await act(async () => {
      h.uploads[0].resolve("/A.png");
      await Promise.resolve();
      expect(drafts.readTerminalComposerDraft(h.key)).toBe(
        "left /A.png  right",
      );
      expect(h.textarea().value).toBe("left SELECT right");
      h.textarea().setSelectionRange(0, 0);
      h.textarea().dispatchEvent(
        new browser.KeyboardEvent("keyup", {
          key: "ArrowLeft",
          bubbles: true,
        }) as unknown as KeyboardEvent,
      );
      h.uploads[1].resolve("/B.png");
    });
    expect(drafts.readTerminalComposerDraft(h.key)).toBe(
      "left /A.png /B.png  right",
    );
  });

  test("identical paths completed together still insert twice", async () => {
    const h = await mount();
    await h.paste();
    await h.paste();
    await act(async () => {
      h.uploads[0].resolve("/same.png");
      h.uploads[1].resolve("/same.png");
    });
    expect(drafts.readTerminalComposerDraft(h.key)).toBe(
      "left /same.png /same.png  right",
    );
  });

  test("reverse completion order uses the latest typed draft and moved caret", async () => {
    const h = await mount();
    await h.paste();
    await h.paste();
    await h.edit("new text remains", 3);
    expect(drafts.readTerminalComposerDraft(h.key)).toBe("new text remains");
    await h.select(4, 8);
    expect(drafts.readTerminalComposerSelection(h.key)).toEqual({
      start: 4,
      end: 8,
    });
    await act(async () => {
      h.uploads[1].resolve("/B.png");
      h.uploads[0].resolve("/A.png");
    });
    expect(drafts.readTerminalComposerDraft(h.key)).toBe(
      "new /B.png /A.png  remains",
    );
    expect(h.sent).toEqual([]);
  });

  test("an older mount's uploads follow the remount's live selection", async () => {
    const h = await mount();
    await h.paste();
    await h.paste();
    await h.remount();
    await h.select(0);
    await act(async () => {
      h.uploads[0].resolve("/A.png");
      h.uploads[1].resolve("/B.png");
    });
    expect(drafts.readTerminalComposerDraft(h.key)).toBe(
      "/A.png  /B.png  left SELECT right",
    );
    expect(h.textarea().selectionStart).toBe(16);
  });

  test("switching panes keeps late uploads in their original draft", async () => {
    const h = await mount();
    await h.paste();
    const next = drafts.terminalComposerDraftKey(h.connection, 1, "pane-b");
    drafts.writeTerminalComposerDraft(next, "other pane");
    await h.switchDraft(next);
    await act(async () => h.uploads[0].resolve("/A.png"));
    expect(drafts.readTerminalComposerDraft(h.key)).toBe("left /A.png  right");
    expect(h.textarea().value).toBe("other pane");
    expect(drafts.readTerminalComposerDraft(next)).toBe("other pane");
  });

  for (const retire of ["scope", "pane"] as const) {
    test(`${retire} retirement discards late uploads without restoring a draft`, async () => {
      const h = await mount();
      await h.paste();
      await act(async () => {
        if (retire === "scope")
          drafts.activateTerminalComposerDraftScope(h.connection, 2);
        else drafts.clearTerminalComposerDrafts(h.connection, 1, ["pane-a"]);
      });
      await act(async () => h.uploads[0].resolve("/A.png"));
      expect(drafts.readTerminalComposerDraft(h.key)).toBe("");
      expect(drafts.terminalComposerUploadCount(h.key)).toBe(0);
    });
  }

  test("each file shows a chip: byte progress, then done; Send waits for it", async () => {
    const h = await mount("note ", 5, 5);
    await h.paste("shot.png");
    const chip = () =>
      h.container.querySelector<HTMLElement>(".attachment-chip");
    expect(chip()?.dataset.status).toBe("uploading");
    expect(chip()?.textContent).toContain("shot.png");
    const send = h.container.querySelector<HTMLButtonElement>(
      '[aria-label="Send draft to the terminal"]',
    )!;
    expect(send.disabled).toBe(true);
    await act(async () => h.progress[0]!(1, 2));
    expect(chip()?.textContent).toContain("Uploading 50%");
    await act(async () => h.uploads[0]!.resolve("/shot.png"));
    expect(chip()?.dataset.status).toBe("done");
    expect(drafts.readTerminalComposerDraft(h.key)).toContain("note /shot.png");
    expect(send.disabled).toBe(false);
  });

  test("the same file again while it uploads is not uploaded twice", async () => {
    const h = await mount("", 0, 0);
    await h.paste("same.png");
    await h.paste("same.png");
    expect(h.uploads.length).toBe(1);
    expect(h.container.querySelectorAll(".attachment-chip").length).toBe(1);
    await act(async () => h.uploads[0]!.resolve("/same.png"));
    expect(drafts.readTerminalComposerDraft(h.key).trim()).toBe("/same.png");
  });

  test("a failed file can be retried or removed", async () => {
    const h = await mount("", 0, 0);
    await h.paste("retry.png");
    await act(async () => h.uploads[0]!.reject(new Error("disk full")));
    const chip = () =>
      h.container.querySelector<HTMLElement>(".attachment-chip");
    expect(chip()?.dataset.status).toBe("failed");
    expect(chip()?.textContent).toContain("disk full");
    await act(async () =>
      h.container
        .querySelector<HTMLButtonElement>('[aria-label="Retry retry.png"]')!
        .click(),
    );
    expect(h.uploads.length).toBe(2);
    expect(chip()?.dataset.status).toBe("uploading");
    await act(async () => h.uploads[1]!.reject(new Error("still full")));
    await act(async () =>
      h.container
        .querySelector<HTMLButtonElement>('[aria-label="Remove retry.png"]')!
        .click(),
    );
    expect(chip()).toBeNull();
    expect(drafts.readTerminalComposerDraft(h.key)).toBe("");
  });

  test("failed upload leaves selection and draft available to the next completion", async () => {
    const h = await mount();
    await h.paste();
    await h.paste();
    await h.setMode("direct");
    await act(async () => h.uploads[0].reject(new Error("Upload failed")));
    expect(drafts.readTerminalComposerDraft(h.key)).toBe("left SELECT right");
    expect(drafts.terminalComposerUploadCount(h.key)).toBe(1);
    await act(async () => h.uploads[1].resolve("/B.png"));
    expect(drafts.readTerminalComposerDraft(h.key)).toBe("left /B.png  right");
    expect(h.errors).toEqual(["Upload failed"]);
  });

  test("inverse UI scale min-height and empty placeholders do not falsely expand or retain inline height across mode switches", async () => {
    const h = await mount("", 0, 0, true);
    const editor = h.textarea();
    editor.style.lineHeight = "22px";
    editor.style.padding = "12px";
    // Simulate --ui-scale < 1 where CSS min-height is 60px (> 57px threshold)
    // unless minHeight is temporarily zeroed during content measurement.
    Object.defineProperty(editor, "scrollHeight", {
      configurable: true,
      get: () => {
        if (editor.value.includes("\n")) return 68;
        return editor.style.minHeight === "0px" ? 46 : 60;
      },
    });
    await h.select(0);
    expect(expanded()).toBe(false);
    expect(editor.style.height).toBe("");

    await h.edit("single line", 11);
    expect(expanded()).toBe(false);
    expect(editor.style.height).toBe("46px");

    await h.edit("first\nsecond", 12);
    expect(expanded()).toBe(true);
    expect(editor.style.height).toBe("68px");

    await h.setMode("direct");
    expect(expanded()).toBe(false);
    expect(editor.style.height).toBe("");

    await h.setMode("composer");
    expect(expanded()).toBe(false);
    await h.select(12);
    expect(expanded()).toBe(true);
    expect(editor.style.height).toBe("68px");

    await h.edit("", 0);
    expect(editor.style.height).toBe("");
  });
}
