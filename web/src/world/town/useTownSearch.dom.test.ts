import { expect, test } from "bun:test";

if (process.env.TOWN_SEARCH_DOM !== "1") {
  test("Town's search in an isolated React DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, TOWN_SEARCH_DOM: "1" },
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
  const browser = globalThis.window as unknown as typeof globalThis;
  for (const [key, value] of Object.entries({
    HTMLButtonElement: browser.HTMLButtonElement,
    HTMLInputElement: browser.HTMLInputElement,
    KeyboardEvent: browser.KeyboardEvent,
    MouseEvent: browser.MouseEvent,
    getComputedStyle: browser.getComputedStyle.bind(browser),
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  const { act, createElement, Fragment } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { fixtureHost, fixtureWorld } = await import("../board/boardFixture");
  const { projectWorldOffice } = await import("../herdrOfficeProjection");
  const { WorldViewToolbar } = await import("../WorldViewToolbar");
  const { WorldSearchResults } = await import("../WorldSearchResults");
  const { useTownSearch } = await import("./useTownSearch");

  const host = fixtureHost("example-host", [
    {
      label: "Platform",
      tabs: [
        { label: "Builder", panes: [["working"]] },
        { label: "Docs", panes: [["idle"]] },
      ],
    },
  ]);
  host.spaces[0]!.children[0]!.taskSummary = "Fix login redirect";
  const world = fixtureWorld([host]);
  const office = projectWorldOffice(world, 0);

  function mount() {
    const opened: string[] = [];
    const seen: { search: unknown }[] = [];
    function Probe() {
      const search = useTownSearch(world, office, (id) => opened.push(id));
      seen.push({ search: search.canvas.search });
      return createElement(
        Fragment,
        null,
        createElement(WorldViewToolbar, {
          viewLabel: "Town",
          ...search.toolbar,
        }),
        createElement(WorldSearchResults, {
          world,
          onSelect: (id: string) => opened.push(id),
          ...search.results,
        }),
        createElement("div", { className: "town-canvas-host", tabIndex: 0 }),
      );
    }
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    act(() => root.render(createElement(Probe)));
    const input = () =>
      element.querySelector<HTMLInputElement>("input[type=search]")!;
    // Typing starts where a user does: the search icon, then the box.
    const type = (value: string) => {
      act(() =>
        element
          .querySelector<HTMLButtonElement>('button[aria-label="Search Town"]')
          ?.click(),
      );
      act(() => {
        const field = input();
        const setter = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(field),
          "value",
        )!.set!;
        setter.call(field, value);
        field.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
    };
    const rows = () => [
      ...element.querySelectorAll<HTMLButtonElement>(
        "[data-world-search-result]",
      ),
    ];
    const click = (button: HTMLButtonElement) =>
      act(() => {
        button.focus();
        button.click();
      });
    const escape = (target: HTMLElement) =>
      act(() => {
        // Keys go where the cursor is.
        target.focus();
        target.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    const chosen = () =>
      (seen[seen.length - 1]!.search as { chosen: unknown } | null)?.chosen ??
      null;
    const unmount = () => {
      act(() => root.unmount());
      element.remove();
    };
    return {
      element,
      opened,
      input,
      type,
      rows,
      click,
      escape,
      chosen,
      unmount,
    };
  }

  test("emptying the box forgets the chosen result", () => {
    const town = mount();
    town.type("login");
    expect(town.rows().length).toBe(1);
    town.click(town.rows()[0]!);
    expect(town.chosen()).not.toBeNull();
    expect(town.opened).toEqual([]);
    town.type("");
    expect(town.rows().length).toBe(0);
    town.type("login");
    expect(town.chosen()).toBeNull();
    // The first choice in the new search shows it again, not opens it.
    town.click(town.rows()[0]!);
    expect(town.opened).toEqual([]);
    expect(town.chosen()).not.toBeNull();
    // Choosing it again opens it.
    town.click(town.rows()[0]!);
    expect(town.opened.length).toBe(1);
    town.unmount();
  });

  test("Escape on a result or the map ends the search", () => {
    const town = mount();
    town.type("login");
    const row = town.rows()[0]!;
    town.click(row);
    expect(town.chosen()).not.toBeNull();
    town.escape(row);
    expect(town.input()).toBeNull();
    expect(town.rows().length).toBe(0);
    expect(town.chosen()).toBeNull();

    town.type("builder");
    town.escape(town.element.querySelector<HTMLElement>(".town-canvas-host")!);
    expect(town.input()).toBeNull();

    // Elsewhere, such as a panel's own field, Escape is that panel's.
    town.type("builder");
    const panel = document.createElement("textarea");
    document.body.append(panel);
    town.escape(panel);
    expect(town.input().value).toBe("builder");
    panel.remove();
    town.unmount();
  });
}
