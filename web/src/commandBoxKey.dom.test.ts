import { expect, test } from "bun:test";

if (process.env.COMMAND_BOX_KEY_DOM !== "1") {
  test("the command box key in an isolated React DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("./testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, COMMAND_BOX_KEY_DOM: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`${out}\n${err}`);
    expect(code).toBe(0);
  }, 20_000);
} else {
  const browser = globalThis.window as unknown as typeof globalThis;
  for (const [key, value] of Object.entries({
    HTMLInputElement: browser.HTMLInputElement,
    KeyboardEvent: browser.KeyboardEvent,
    CustomEvent: browser.CustomEvent,
    NodeFilter: browser.NodeFilter,
    MutationObserver: browser.MutationObserver,
    FocusEvent: browser.FocusEvent,
    PointerEvent: browser.PointerEvent,
    requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
    cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
    getComputedStyle: browser.getComputedStyle.bind(browser),
    // cmdk measures its list; nothing here resizes.
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { selectShortcutPreset } = await import("./shortcutPreferences");
  const { commandBoxKey, openCommandBox } = await import("./commandBoxKey");
  const { CommandCombobox } = await import("./components/CommandCombobox");

  type Keys = { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean };
  const keyK = (keys: Keys) =>
    new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      bubbles: true,
      cancelable: true,
      ...keys,
    });
  const opens = (target: EventTarget, keys: Keys) => {
    let result = false;
    const listen = (event: Event) => {
      result = commandBoxKey(event as KeyboardEvent);
    };
    window.addEventListener("keydown", listen, true);
    target.dispatchEvent(keyK(keys));
    window.removeEventListener("keydown", listen, true);
    return result;
  };

  const terminal = document.createElement("div");
  terminal.className = "xterm";
  const terminalInput = document.createElement("textarea");
  terminal.append(terminalInput);
  const composer = document.createElement("textarea");
  const field = document.createElement("input");
  const editable = document.createElement("div");
  editable.contentEditable = "true";
  const button = document.createElement("button");
  document.body.append(terminal, composer, field, editable, button);
  const typed = [terminalInput, composer, field, editable];

  test("Ctrl+K opens the box anywhere but where text is typed", () => {
    selectShortcutPreset("linux");
    expect(opens(document.body, { ctrlKey: true })).toBe(true);
    expect(opens(button, { ctrlKey: true })).toBe(true);
    // A terminal, the Chat composer and text fields keep Ctrl+K.
    for (const target of typed)
      expect(opens(target, { ctrlKey: true })).toBe(false);
    // Ctrl+Alt+K is no shell or editor key, so it opens the box from there.
    for (const target of typed)
      expect(opens(target, { ctrlKey: true, altKey: true })).toBe(true);
    // A key held down opens nothing again.
    const held = new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      ctrlKey: true,
      repeat: true,
    });
    expect(commandBoxKey(held)).toBe(false);
  });

  test("on a Mac Cmd+K opens it but where text is typed", () => {
    selectShortcutPreset("mac");
    expect(opens(document.body, { metaKey: true })).toBe(true);
    expect(opens(button, { metaKey: true })).toBe(true);
    // A terminal, the Chat composer and text fields keep Cmd+K.
    for (const target of typed)
      expect(opens(target, { metaKey: true })).toBe(false);
    // Cmd+Option+K opens the box from there.
    for (const target of typed)
      expect(opens(target, { metaKey: true, altKey: true })).toBe(true);
    for (const target of [document.body, ...typed])
      expect(opens(target, { ctrlKey: true })).toBe(false);
    selectShortcutPreset("linux");
  });

  test("the box finds World's items and its key closes it again", async () => {
    selectShortcutPreset("linux");
    const chosen: string[] = [];
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    act(() =>
      root.render(
        createElement(CommandCombobox, {
          extension: {
            captureKey: null,
            groups: [
              {
                heading: "Views",
                actions: [
                  {
                    key: "go-board",
                    icon: null,
                    title: "Go to Board",
                    run() {},
                  },
                ],
              },
            ],
            placeholder: "Find an agent",
            find: (search) =>
              search.includes("harbor")
                ? {
                    heading: "In World",
                    actions: [
                      {
                        key: "find-builder",
                        icon: null,
                        title: "builder",
                        detail: "Agent · atlas › harbor",
                        score: 0.8,
                        run: () => chosen.push("builder"),
                      },
                    ],
                  }
                : null,
          },
        }),
      ),
    );
    const popover = () => document.querySelector(".command-popover");
    // Ctrl+K in a field types there; outside one it opens the box.
    act(() => {
      field.dispatchEvent(keyK({ ctrlKey: true }));
    });
    expect(popover()).toBeNull();
    const pressed = keyK({ ctrlKey: true });
    act(() => {
      document.body.dispatchEvent(pressed);
    });
    expect(pressed.defaultPrevented).toBe(true);
    expect(popover()).not.toBeNull();
    const input = popover()!.querySelector<HTMLInputElement>("input")!;
    expect(input.placeholder).toBe("Find an agent");
    expect(popover()!.textContent).toContain("Go to Board");
    // The search finds the agent by its place, which no action title has.
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setValue.call(input, "harbor");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(popover()!.textContent).toContain("builder");
    expect(popover()!.textContent).toContain("Agent · atlas › harbor");
    expect(popover()!.textContent).not.toContain("Go to Board");
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(chosen).toEqual(["builder"]);
    expect(popover()).toBeNull();
    // The phone's menu opens it by event; its key, pressed inside, closes it.
    act(() => openCommandBox());
    expect(popover()).not.toBeNull();
    act(() => {
      popover()!
        .querySelector("input")!
        .dispatchEvent(keyK({ ctrlKey: true }));
    });
    expect(popover()).toBeNull();
    act(() => root.unmount());
    element.remove();
  });
}
