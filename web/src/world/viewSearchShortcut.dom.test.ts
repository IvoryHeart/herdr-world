import { expect, test } from "bun:test";

if (process.env.VIEW_SEARCH_SHORTCUT_DOM !== "1") {
  test("the one search's keys in an isolated React DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, VIEW_SEARCH_SHORTCUT_DOM: "1" },
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
  }, 15_000);
} else {
  const browser = globalThis.window as unknown as typeof globalThis & {
    happyDOM: { setViewport(viewport: { width: number }): void };
  };
  for (const [key, value] of Object.entries({
    HTMLInputElement: browser.HTMLInputElement,
    KeyboardEvent: browser.KeyboardEvent,
    getComputedStyle: browser.getComputedStyle.bind(browser),
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { getShortcutSnapshot, selectShortcutPreset, updateShortcut } =
    await import("../shortcutPreferences");
  const { WorldViewToolbar } = await import("./WorldViewToolbar");
  const { keyTakenByViewSearch, useViewSearchShortcut } = await import(
    "./viewSearchShortcut"
  );
  const { COMMAND_BOX_OPEN_EVENT } = await import("../commandBoxKey");

  // Ctrl+F, or Cmd+F where this DOM reports a Mac.
  const findModifier = getShortcutSnapshot().preset.bindings[
    "view.search"
  ].includes("Meta+F")
    ? "metaKey"
    : "ctrlKey";
  const press = (target: EventTarget, key: "/" | "f") => {
    const event = new KeyboardEvent("keydown", {
      key,
      code: key === "/" ? "Slash" : "KeyF",
      [findModifier]: key === "f",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      target.dispatchEvent(event);
    });
    return event.defaultPrevented;
  };

  /** The one search's key listener, as the command box mounts it. */
  function mount(enabled = true) {
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    let opened = 0;
    function Box() {
      useViewSearchShortcut(() => {
        opened += 1;
      }, enabled);
      return null;
    }
    act(() => root.render(createElement(Box)));
    return {
      opened: () => opened,
      unmount: () => {
        act(() => root.unmount());
        element.remove();
      },
    };
  }

  test("/ and the find key open the one search", () => {
    const box = mount();
    expect(press(document.body, "/")).toBe(true);
    expect(box.opened()).toBe(1);
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    // The browser's find stays closed.
    expect(press(button, "f")).toBe(true);
    expect(box.opened()).toBe(2);
    button.remove();
    box.unmount();
  });

  test("with the shortcuts off, the keys do nothing", () => {
    const box = mount(false);
    expect(press(document.body, "/")).toBe(false);
    expect(box.opened()).toBe(0);
    box.unmount();
  });

  test("keys typed into a terminal, composer or field stay there", () => {
    const box = mount();
    const terminal = document.createElement("div");
    terminal.className = "xterm";
    const terminalInput = document.createElement("textarea");
    terminal.append(terminalInput);
    const composer = document.createElement("textarea");
    const field = document.createElement("input");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.append(terminal, composer, field, editable);
    for (const target of [terminal, terminalInput, composer, field, editable])
      for (const key of ["/", "f"] as const)
        expect(press(target, key)).toBe(false);
    expect(box.opened()).toBe(0);
    // An open dialog, menu or the search box itself owns the keyboard too.
    for (const owner of ['[role="menu"]', ".command-popover"]) {
      const node = document.createElement("div");
      if (owner.startsWith("[")) node.setAttribute("role", "menu");
      else node.className = "command-popover";
      document.body.append(node);
      expect(press(document.body, "/")).toBe(false);
      node.remove();
    }
    expect(box.opened()).toBe(0);
    for (const node of [terminal, composer, field, editable]) node.remove();
    box.unmount();
  });

  test("a search key never also runs a view's own key handler", () => {
    // A view handler registered before the search, and one after it.
    const seen: string[] = [];
    const view = (when: string) => (event: KeyboardEvent) => {
      if (!keyTakenByViewSearch(event)) seen.push(`${when} ${event.key}`);
    };
    const before = view("before");
    window.addEventListener("keydown", before);
    const box = mount();
    const after = view("after");
    window.addEventListener("keydown", after);
    act(() => updateShortcut("view.search", ["J"]));
    const pressJ = (key: string) => {
      const event = new KeyboardEvent("keydown", {
        key,
        code: `Key${key.toUpperCase()}`,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        document.body.dispatchEvent(event);
      });
    };
    pressJ("j");
    expect(box.opened()).toBe(1);
    expect(seen).toEqual([]);
    // Other keys still reach the view.
    pressJ("k");
    expect(seen).toEqual(["before k", "after k"]);
    act(() => selectShortcutPreset("auto"));
    window.removeEventListener("keydown", before);
    window.removeEventListener("keydown", after);
    box.unmount();
  });

  test("a view's toolbar opens the one search and shows the running one", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    const opens: boolean[] = [];
    const onOpen = (event: Event) => {
      opens.push((event as CustomEvent<{ resume: boolean }>).detail.resume);
    };
    window.addEventListener(COMMAND_BOX_OPEN_EVENT, onOpen);
    let ended = 0;
    const render = (query: string) =>
      act(() =>
        root.render(
          createElement(WorldViewToolbar, {
            viewLabel: "Town",
            query,
            resultLabel: query ? "2 matches" : undefined,
            onClear: () => {
              ended += 1;
            },
          }),
        ),
      );
    render("");
    // No box of its own: the view's search is the one search.
    expect(element.querySelector("input")).toBeNull();
    const toggle = element.querySelector<HTMLButtonElement>(
      'button[aria-label="Find in World"]',
    )!;
    expect(toggle.title).toMatch(/^Find in World \(\/ or (Ctrl|Cmd)\+F\)$/);
    act(() => toggle.click());
    // The button opens it empty; the running search's chip resumes it.
    expect(opens).toEqual([false]);
    render("harbor");
    const search = element.querySelector('[role="search"]')!;
    expect(search.getAttribute("aria-label")).toBe("Town search");
    expect(search.textContent).toContain("harbor");
    expect(search.textContent).toContain("2 matches");
    act(() =>
      element
        .querySelector<HTMLButtonElement>(".world-view-search-query")!
        .click(),
    );
    expect(opens).toEqual([false, true]);
    act(() =>
      element
        .querySelector<HTMLButtonElement>('button[aria-label="End search"]')!
        .click(),
    );
    expect(ended).toBe(1);
    window.removeEventListener(COMMAND_BOX_OPEN_EVENT, onOpen);
    act(() => root.unmount());
    element.remove();
  });
}
