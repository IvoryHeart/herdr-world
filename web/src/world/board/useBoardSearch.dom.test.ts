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
    KeyboardEvent: browser.KeyboardEvent,
    MouseEvent: browser.MouseEvent,
    getComputedStyle: browser.getComputedStyle.bind(browser),
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { fixtureHost, fixtureWorld } = await import("./boardFixture");
  const { projectBoard } = await import("./boardModel");
  const { boardSearchMatches } = await import("./boardSearch");
  const { WorldViewToolbar } = await import("../WorldViewToolbar");
  const { worldSearchResults } = await import("../worldSearch");
  const { worldFinder } = await import("../worldFinder");
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
    let matches: Set<string> | null = null;
    let chosen: ReturnType<typeof useBoardSearch>["chosen"] = null;
    function Probe() {
      const search = useBoardSearch(world, model);
      matches = search.matches;
      chosen = search.chosen;
      return createElement(WorldViewToolbar, {
        viewLabel: "Board",
        ...search.toolbar,
      });
    }
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    act(() => root.render(createElement(Probe)));
    const key = (target: HTMLElement, name: string, taken = false) =>
      act(() => {
        // Keys go where the cursor is.
        target.focus();
        const event = new KeyboardEvent("keydown", {
          key: name,
          bubbles: true,
          cancelable: true,
        });
        if (taken) event.preventDefault();
        target.dispatchEvent(event);
      });
    const chip = () => element.querySelector('[role="search"]');
    const unmount = () => {
      act(() => root.unmount());
      act(() => worldFinder.end());
      element.remove();
    };
    return {
      element,
      matches: () => matches,
      chosen: () => chosen,
      key,
      chip,
      unmount,
    };
  }

  test("typing in the box lights Board's matches and counts World's", () => {
    const board = mount();
    expect(board.matches()).toBeNull();
    expect(board.chip()).toBeNull();
    act(() => worldFinder.type("board", "platform"));
    const count = worldSearchResults(world, "platform").length;
    expect(count).toBeGreaterThan(1);
    expect(board.matches()).toEqual(boardSearchMatches(model, "platform"));
    expect(
      board.element.querySelector(".world-view-toolbar-results")?.textContent,
    ).toBe(`${count} matches`);
    board.unmount();
  });

  test("a choice in the box names its card, again on each choice", () => {
    const board = mount();
    expect(board.chosen()).toBeNull();
    const result = worldSearchResults(world, "builder").find(
      (found) => found.kind === "agent" || found.kind === "terminal",
    )!;
    const builder = model.tabs.find((tab) => tab.label === "Builder")!;
    act(() => worldFinder.choose("board", "builder", result));
    const first = board.chosen()!;
    expect(first.key).toBe(builder.key);
    expect(first.nodeId).toBe(result.nodeId);
    act(() => worldFinder.choose("board", "builder", result));
    expect(board.chosen()!.seq).toBeGreaterThan(first.seq);
    // Town's choices are not Board's.
    act(() => worldFinder.choose("town", "builder", result));
    expect(board.chosen()).toBeNull();
    board.unmount();
  });

  test("another view's search leaves Board alone", () => {
    const board = mount();
    act(() => worldFinder.type("town", "platform"));
    expect(board.matches()).toBeNull();
    expect(board.chip()).toBeNull();
    board.unmount();
  });

  test("the chip's end and Escape on the board end the search", () => {
    const board = mount();
    const surface = document.createElement("div");
    surface.className = "board";
    surface.tabIndex = -1;
    board.element.append(surface);
    act(() => worldFinder.type("board", "login"));
    act(() =>
      board.element
        .querySelector<HTMLButtonElement>('button[aria-label="End search"]')!
        .click(),
    );
    expect(worldFinder.get()).toBeNull();
    expect(board.matches()).toBeNull();
    act(() => worldFinder.type("board", "login"));
    // A key something else took, such as a carried pane, keeps the search.
    board.key(surface, "Escape", true);
    expect(board.chip()?.textContent).toContain("login");
    board.key(surface, "Escape");
    expect(board.chip()).toBeNull();
    // Escape aimed elsewhere, such as a dialog, is not Board's.
    act(() => worldFinder.type("board", "login"));
    const dialog = document.createElement("button");
    document.body.append(dialog);
    board.key(dialog, "Escape");
    expect(board.chip()).not.toBeNull();
    dialog.remove();
    board.unmount();
  });
}
