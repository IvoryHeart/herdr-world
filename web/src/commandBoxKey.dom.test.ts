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
          },
          // World's finds, given in every view, Spaces included (#1329).
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
                      secondary: {
                        label: "Open terminal",
                        run: () => chosen.push("open builder"),
                      },
                    },
                  ],
                }
              : null,
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
    // Shift+Enter takes the find's second action: open its terminal.
    act(() => {
      document.body.dispatchEvent(keyK({ ctrlKey: true }));
    });
    const again = popover()!.querySelector<HTMLInputElement>("input")!;
    act(() => {
      setValue.call(again, "harbor");
      again.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(
      popover()!.querySelector(".command-item-secondary")?.textContent,
    ).toBe("Open terminal");
    act(() => {
      again.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(chosen).toEqual(["builder", "open builder"]);
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
  test("finds that read alike page, and every one can be chosen", () => {
    selectShortcutPreset("linux");
    const chosen: string[] = [];
    const asked: number[] = [];
    const size = 12;
    const total = 13;
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    act(() =>
      root.render(
        createElement(CommandCombobox, {
          extension: { captureKey: null, groups: [] },
          // Thirteen agents no further word tells apart: same name and place.
          find: (search, from) => {
            if (!search.includes("codex")) return null;
            asked.push(from);
            const start = Math.min(from, total - 1);
            return {
              heading: "In World",
              actions: Array.from(
                { length: Math.min(size, total - start) },
                (_, index) => ({
                  key: `find-codex-${start + index + 1}`,
                  icon: null,
                  title: "codex",
                  detail: "Agent · atlas › harbor",
                  score: 0.95,
                  run: () => chosen.push(`codex ${start + index + 1}`),
                }),
              ),
              page: { from: start, size, total },
            };
          },
        }),
      ),
    );
    const popover = () => document.querySelector(".command-popover");
    const rows = () => [
      ...document.querySelectorAll<HTMLElement>("[cmdk-item]"),
    ];
    const finds = () =>
      rows().filter((row) => row.dataset.value?.includes("find-codex-"));
    const type = (value: string) => {
      const input = popover()!.querySelector<HTMLInputElement>("input")!;
      act(() => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    act(() => {
      document.body.dispatchEvent(keyK({ ctrlKey: true }));
    });
    type("codex");
    // Alike finds stay separate rows: a bounded page and a row to the next.
    expect(finds()).toHaveLength(size);
    expect(popover()!.textContent).toContain("Next 1");
    expect(popover()!.textContent).toContain("13 of 13");
    expect(popover()!.textContent).not.toContain("Previous");
    act(() => {
      rows()
        .find((item) => item.dataset.value?.includes("find-page-next"))!
        .click();
    });
    // Paging keeps the box open on the next page, with a way back.
    expect(popover()).not.toBeNull();
    expect(chosen).toEqual([]);
    expect(finds().map((item) => item.dataset.value?.split(" ").pop())).toEqual(
      ["find-codex-13"],
    );
    expect(
      rows().some((item) => item.dataset.value?.includes("find-page-previous")),
    ).toBe(true);
    expect(
      rows().some((item) => item.dataset.value?.includes("find-page-next")),
    ).toBe(false);
    // The thirteenth is chosen like any other find.
    act(() => {
      finds()[0]!.click();
    });
    expect(chosen).toEqual(["codex 13"]);
    expect(popover()).toBeNull();
    // A new search starts again at the first page.
    act(() => {
      document.body.dispatchEvent(keyK({ ctrlKey: true }));
    });
    type("codex");
    act(() => {
      rows()
        .find((item) => item.dataset.value?.includes("find-page-next"))!
        .click();
    });
    type("codex harbor");
    expect(asked[asked.length - 1]).toBe(0);
    expect(finds()).toHaveLength(size);
    act(() => {
      popover()!
        .querySelector("input")!
        .dispatchEvent(keyK({ ctrlKey: true }));
    });
    expect(popover()).toBeNull();
    act(() => root.unmount());
    element.remove();
  });
  test("a find the view only showed keeps the list; choosing it again opens it", () => {
    selectShortcutPreset("linux");
    const log: string[] = [];
    let shown = "";
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    act(() =>
      root.render(
        createElement(CommandCombobox, {
          extension: { captureKey: null, groups: [] },
          // Town's rule: the first choice flies there, the same one again opens.
          find: () => ({
            heading: "In World",
            actions: ["harbor", "atlas"].map((name) => ({
              key: `find-${name}`,
              icon: null,
              title: name,
              score: 0.95,
              stay: () => shown !== name,
              run: () => {
                log.push(shown === name ? `open ${name}` : `go ${name}`);
                shown = name;
              },
            })),
          }),
        }),
      ),
    );
    const popover = () => document.querySelector(".command-popover");
    const input = () => popover()!.querySelector<HTMLInputElement>("input")!;
    const row = (name: string) =>
      document.querySelector<HTMLElement>(
        `[cmdk-item][data-value*="find-${name}"]`,
      )!;
    const enter = () =>
      act(() => {
        input().dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    const click = (name: string) =>
      act(() => {
        row(name).dispatchEvent(
          new PointerEvent("pointermove", { bubbles: true }),
        );
        row(name).click();
      });
    act(() => {
      document.body.dispatchEvent(keyK({ ctrlKey: true }));
    });
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input(), "a");
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    // A click does what Enter does: goes there, the list stays, Enter is next.
    click("atlas");
    expect(log).toEqual(["go atlas"]);
    expect(popover()).not.toBeNull();
    expect(document.activeElement).toBe(input());
    expect(row("atlas").getAttribute("aria-selected")).toBe("true");
    // Enter on the same row opens it and closes the box.
    enter();
    expect(log).toEqual(["go atlas", "open atlas"]);
    expect(popover()).toBeNull();
    // Clicking the shown row again opens it as well.
    act(() => {
      document.body.dispatchEvent(keyK({ ctrlKey: true }));
    });
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input(), "a");
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    click("harbor");
    click("harbor");
    expect(log).toEqual(["go atlas", "open atlas", "go harbor", "open harbor"]);
    expect(popover()).toBeNull();
    act(() => root.unmount());
    element.remove();
  });
  test("/, Ctrl+F and Cmd+K open the same box, sharing its search with the view", () => {
    selectShortcutPreset("linux");
    const log: string[] = [];
    let running = "";
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    act(() =>
      root.render(
        createElement(CommandCombobox, {
          extension: { captureKey: null, groups: [] },
          find: () => null,
          finderSearch: {
            seed: () => running,
            change: (value: string) => {
              running = value;
              log.push(`type ${value}`);
            },
            closed: () => log.push("closed"),
          },
        }),
      ),
    );
    const popover = () => document.querySelector(".command-popover");
    const press = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      act(() => {
        document.body.dispatchEvent(event);
      });
      return event.defaultPrevented;
    };
    const input = () => popover()!.querySelector<HTMLInputElement>("input")!;
    const close = () =>
      act(() => {
        input().dispatchEvent(keyK({ ctrlKey: true }));
      });
    // `/` opens it, and what is typed reaches the view as it is typed.
    expect(press({ key: "/", code: "Slash" })).toBe(true);
    expect(popover()).not.toBeNull();
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input(), "harbor");
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(log).toEqual(["type harbor"]);
    close();
    expect(log).toEqual(["type harbor", "closed"]);
    // Ctrl+F and Ctrl+K open the same box, empty, for a new search.
    expect(press({ key: "f", code: "KeyF", ctrlKey: true })).toBe(true);
    expect(input().value).toBe("");
    close();
    expect(press({ key: "k", code: "KeyK", ctrlKey: true })).toBe(true);
    expect(input().value).toBe("");
    close();
    // The view's search chip resumes the running search.
    act(() => openCommandBox({ resume: true }));
    expect(input().value).toBe("harbor");
    close();
    // In a text field `/` types there.
    const typedField = document.createElement("input");
    document.body.append(typedField);
    const slash = new KeyboardEvent("keydown", {
      key: "/",
      code: "Slash",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      typedField.dispatchEvent(slash);
    });
    expect(slash.defaultPrevented).toBe(false);
    expect(popover()).toBeNull();
    typedField.remove();
    act(() => root.unmount());
    element.remove();
  });
}
