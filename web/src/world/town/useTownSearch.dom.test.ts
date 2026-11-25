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
  const { worldFinder } = await import("../worldFinder");
  const { useTownSearch, townSearchResults, townSearchKey } = await import(
    "./useTownSearch"
  );

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

  type Canvas = {
    search: {
      keys: string[];
      chosen: { key: string; seq: number } | null;
    } | null;
    onUnmapped(key: string): void;
  };

  function mount() {
    const opened: string[] = [];
    let canvas: Canvas | null = null;
    function Probe() {
      const search = useTownSearch(world, office, (id) => opened.push(id));
      canvas = search.canvas;
      return createElement(
        Fragment,
        null,
        createElement(WorldViewToolbar, {
          viewLabel: "Town",
          ...search.toolbar,
        }),
        createElement("div", { className: "town-canvas-host", tabIndex: 0 }),
      );
    }
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    act(() => root.render(createElement(Probe)));
    /** Type in the one search box, as it does in Town. */
    const type = (query: string) => act(() => worldFinder.type("town", query));
    /** Choose its first result, as Enter or a click in the box does. */
    const choose = (query: string) => {
      const result = townSearchResults(world, query)[0]!;
      act(() => worldFinder.choose("town", query, result));
      return result;
    };
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
    const chip = () => element.querySelector('[role="search"]');
    const unmount = () => {
      act(() => root.unmount());
      act(() => worldFinder.end());
      element.remove();
    };
    return {
      element,
      opened,
      type,
      choose,
      escape,
      chip,
      canvas: () => canvas!,
      unmount,
    };
  }

  test("typing lights matches; choosing flies to the result, again on each choice", () => {
    const town = mount();
    expect(town.canvas().search).toBeNull();
    town.type("platform");
    expect(town.canvas().search!.keys.length).toBeGreaterThan(1);
    expect(town.canvas().search!.chosen).toBeNull();
    const result = town.choose("login");
    const first = town.canvas().search!.chosen!;
    expect(first.key).toBe(townSearchKey(office, result));
    // Choosing again goes there again; it never opens the result.
    town.choose("login");
    expect(town.canvas().search!.chosen!.seq).toBeGreaterThan(first.seq);
    expect(town.opened).toEqual([]);
    expect(town.chip()?.textContent).toContain("login");
    town.unmount();
  });

  test("closing the box without choosing ends the search; a choice keeps it", () => {
    const town = mount();
    town.type("login");
    act(() => worldFinder.closed());
    expect(town.canvas().search).toBeNull();
    town.choose("login");
    act(() => worldFinder.closed());
    expect(town.canvas().search!.chosen).not.toBeNull();
    // Typing a new search forgets the chosen result.
    town.type("builder");
    expect(town.canvas().search!.chosen).toBeNull();
    town.unmount();
  });

  test("a chosen result Town does not draw opens as selecting does", () => {
    const town = mount();
    const result = town.choose("login");
    const key = town.canvas().search!.chosen!.key;
    act(() => town.canvas().onUnmapped(key));
    expect(town.opened).toEqual([result.nodeId]);
    town.unmount();
  });

  test("the warehouse is found and shown, never opened (#1033, #1028)", () => {
    const town = mount();
    for (const query of ["warehouse", "pull requests"]) {
      expect(townSearchResults(world, query)[0]!.label).toContain("Warehouse");
      town.choose(query);
      expect(town.canvas().search!.chosen).toMatchObject({
        key: "town:warehouse",
      });
      act(() => town.canvas().onUnmapped("town:warehouse"));
      expect(town.opened).toEqual([]);
    }
    // Other words do not find it.
    expect(
      townSearchResults(world, "login").map((result) => result.label),
    ).not.toContainEqual(expect.stringContaining("Warehouse"));
    town.unmount();
  });

  test("Escape on the map or the chip's end ends the search", () => {
    const town = mount();
    town.choose("login");
    town.escape(town.element.querySelector<HTMLElement>(".town-canvas-host")!);
    expect(town.canvas().search).toBeNull();
    expect(town.chip()).toBeNull();

    town.type("builder");
    act(() =>
      town.element
        .querySelector<HTMLButtonElement>('button[aria-label="End search"]')!
        .click(),
    );
    expect(town.canvas().search).toBeNull();

    // Elsewhere, such as a panel's own field, Escape is that panel's.
    town.type("builder");
    const panel = document.createElement("textarea");
    document.body.append(panel);
    town.escape(panel);
    expect(town.chip()?.textContent).toContain("builder");
    panel.remove();
    town.unmount();
  });
}
