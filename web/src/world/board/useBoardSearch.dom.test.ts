import { expect, test } from "bun:test";

if (process.env.BOARD_SEARCH_DOM !== "1") {
  test("Board's search in an isolated React DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, BOARD_SEARCH_DOM: "1" },
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
  const { fixtureHost, fixtureWorld } = await import("./boardFixture");
  const { projectBoard } = await import("./boardModel");
  const { WorldViewToolbar } = await import("../WorldViewToolbar");
  const { WorldSearchResults } = await import("../WorldSearchResults");
  const { worldSearchResults } = await import("../worldSearch");
  const { useBoardSearch } = await import("./useBoardSearch");

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
  const model = projectBoard(world);

  function mount() {
    const selected: string[] = [];
    function Probe() {
      const search = useBoardSearch(world, model, (id) => selected.push(id));
      return createElement(
        Fragment,
        null,
        createElement(WorldViewToolbar, {
          viewLabel: "Board",
          ...search.toolbar,
        }),
        search.open
          ? createElement(WorldSearchResults, {
              world,
              onSelect: (id: string) => selected.push(id),
              ...search.results,
            })
          : null,
      );
    }
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    act(() => root.render(createElement(Probe)));
    const input = () =>
      element.querySelector<HTMLInputElement>("input[type=search]")!;
    const type = (value: string) =>
      act(() => {
        const field = input();
        const setter = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(field),
          "value",
        )!.set!;
        setter.call(field, value);
        field.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
    const key = (target: HTMLElement, name: string) =>
      act(() => {
        target.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: name,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    const submit = () =>
      act(() => {
        input()
          .closest("form")!
          .dispatchEvent(
            new window.Event("submit", { bubbles: true, cancelable: true }),
          );
      });
    const rows = () => [
      ...element.querySelectorAll<HTMLButtonElement>(
        "[data-world-search-result]",
      ),
    ];
    const unmount = () => {
      act(() => root.unmount());
      element.remove();
    };
    return { element, selected, input, type, key, submit, rows, unmount };
  }

  test("the toolbar counts what the results list shows", () => {
    const board = mount();
    board.type("platform");
    const count = worldSearchResults(world, "platform").length;
    expect(count).toBeGreaterThan(1);
    expect(board.rows().length).toBe(count);
    expect(
      board.element.querySelector(".world-view-toolbar-results")?.textContent,
    ).toBe(`${count} matches`);
    expect(
      board.element.querySelector(".world-search-results [role=status]")
        ?.textContent,
    ).toBe(`${count} matches`);
    board.unmount();
  });

  test("Down and Enter select the result they are on", () => {
    const board = mount();
    board.type("platform");
    const results = worldSearchResults(world, "platform");
    board.key(board.input(), "ArrowDown");
    expect(board.rows()[1]!.getAttribute("aria-current")).toBe("true");
    board.submit();
    expect(board.selected).toEqual([results[1]!.nodeId]);
    board.unmount();
  });

  test("Escape in the box or on a result ends the search", () => {
    const board = mount();
    board.type("login");
    expect(board.rows().length).toBe(1);
    board.key(board.rows()[0]!, "Escape");
    expect(board.input().value).toBe("");
    expect(board.rows().length).toBe(0);
    board.type("login");
    board.key(board.input(), "Escape");
    expect(board.input().value).toBe("");
    board.unmount();
  });
}
