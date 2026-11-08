import { expect, test } from "bun:test";

if (process.env.VIEW_SEARCH_SHORTCUT_DOM !== "1") {
  test("the view search shortcut in an isolated React DOM", async () => {
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
  const { keyTakenByViewSearch } = await import("./viewSearchShortcut");

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

  function mount() {
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    act(() =>
      root.render(
        createElement(WorldViewToolbar, {
          viewLabel: "Town",
          query: "",
          onQueryChange: () => {},
        }),
      ),
    );
    const input = () =>
      document.querySelector<HTMLInputElement>("input[type=search]");
    return {
      input,
      focused: () => document.activeElement === input(),
      unmount: () => {
        act(() => root.unmount());
        element.remove();
      },
    };
  }

  test("/ and the find key put the cursor in the view's search", () => {
    const town = mount();
    expect(press(document.body, "/")).toBe(true);
    expect(town.focused()).toBe(true);
    town.input()!.blur();
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    // The browser's find stays closed.
    expect(press(button, "f")).toBe(true);
    expect(town.focused()).toBe(true);
    button.remove();
    town.unmount();
  });

  test("keys typed into a terminal, composer or field stay there", () => {
    const town = mount();
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
      for (const key of ["/", "f"] as const) {
        expect(press(target, key)).toBe(false);
        expect(town.focused()).toBe(false);
      }
    // An open dialog or menu owns the keyboard too.
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.append(menu);
    expect(press(document.body, "/")).toBe(false);
    expect(town.focused()).toBe(false);
    for (const node of [terminal, composer, field, editable, menu])
      node.remove();
    town.unmount();
  });

  test("a search key never also runs a view's own key handler", () => {
    // A view handler registered before the search, and one after it.
    const seen: string[] = [];
    const view = (when: string) => (event: KeyboardEvent) => {
      if (!keyTakenByViewSearch(event)) seen.push(`${when} ${event.key}`);
    };
    const before = view("before");
    window.addEventListener("keydown", before);
    const town = mount();
    const after = view("after");
    window.addEventListener("keydown", after);
    updateShortcut("view.search", ["J"]);
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
    expect(town.focused()).toBe(true);
    expect(seen).toEqual([]);
    town.input()!.blur();
    // Other keys still reach the view.
    pressJ("k");
    expect(seen).toEqual(["before k", "after k"]);
    selectShortcutPreset("auto");
    window.removeEventListener("keydown", before);
    window.removeEventListener("keydown", after);
    town.unmount();
  });

  test("on a phone the key opens the search the search icon opens", () => {
    browser.happyDOM.setViewport({ width: 400 });
    const town = mount();
    expect(town.input()).toBeNull();
    expect(press(document.body, "/")).toBe(true);
    expect(town.input()).not.toBeNull();
    expect(town.focused()).toBe(true);
    town.input()!.blur();
    // Pressed again while it is open, it returns the cursor to it.
    expect(press(document.body, "f")).toBe(true);
    expect(town.focused()).toBe(true);
    town.unmount();
    browser.happyDOM.setViewport({ width: 1024 });
  });
}
