import { expect, test } from "bun:test";

if (process.env.TOWN_CENSUS_DOM !== "1") {
  test("Town's census lights what it counts, in an isolated React DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, TOWN_CENSUS_DOM: "1" },
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
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  const { act, createElement, Fragment } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useTownCensus } = await import("./useTownCensus");
  const { useTownSearch } = await import("./useTownSearch");
  const { TownCensusBoard, TownCensusCounts, TownCensusShowing } = await import(
    "./TownCensusView"
  );
  const { town } = await import("./townCensus.fixture");

  type Search = ReturnType<typeof useTownSearch>;

  async function mount() {
    const { world, office, summary } = await town();
    const host = document.createElement("div");
    host.className = "town-board";
    document.body.append(host);
    const root = createRoot(host);
    const seen: { search: Search | null } = { search: null };
    function Probe() {
      const census = useTownCensus({ world, office, summary, profiles: null });
      const search = useTownSearch(world, office, () => undefined, census);
      seen.search = search;
      const control = search.canvas.census!;
      return createElement(
        Fragment,
        null,
        createElement(TownCensusCounts, { control }),
        createElement(TownCensusBoard, { control }),
        createElement(TownCensusShowing, { control, variant: "chip" }),
      );
    }
    await act(async () => root.render(createElement(Probe)));
    const button = (label: RegExp) =>
      [...host.querySelectorAll("button")].find((b) =>
        label.test(b.getAttribute("aria-label") ?? b.textContent ?? ""),
      ) as HTMLButtonElement | undefined;
    const click = async (label: RegExp) => {
      const target = button(label);
      if (!target) throw new Error(`no button ${label}`);
      await act(async () => target.click());
    };
    return { office, host, root, seen, button, click };
  }

  test("choosing waiting on you lights the waiting agents, and choosing it again ends it", async () => {
    const { office, host, root, seen, click, button } = await mount();
    const blocked = office.roster.find(
      ({ agent }) => agent.semanticStatus === "blocked",
    )!.agent;
    expect(seen.search!.canvas.search).toBeNull();
    await click(/^Show 1 waiting on you/);
    expect(seen.search!.canvas.search).toEqual({
      keys: [blocked.key],
      chosen: null,
    });
    expect(
      button(/^Stop showing 1 waiting on you/)!.getAttribute("aria-pressed"),
    ).toBe("true");
    // Both the board's line and the phone chip say what is lit.
    expect(host.querySelector(".town-census-showing")!.textContent).toContain(
      "Showing 1 waiting on you",
    );
    expect(host.querySelector(".town-census-chip")!.textContent).toContain(
      "Showing 1 waiting on you",
    );
    // Next shows its places one at a time, as choosing a result does.
    await act(async () =>
      (
        host.querySelector(".town-census-chip button") as HTMLButtonElement
      ).click(),
    );
    expect(seen.search!.canvas.search!.chosen).toEqual({
      key: blocked.key,
      seq: 1,
    });
    await click(/^Stop showing 1 waiting on you/);
    expect(seen.search!.canvas.search).toBeNull();
    expect(host.querySelector(".town-census-chip")).toBeNull();
    await act(async () => root.unmount());
    host.remove();
  });

  test("places and skills light theirs; ✕, Escape or a search ends it", async () => {
    const { office, host, root, seen, click } = await mount();
    await click(/^Show 3 rooms/);
    expect(new Set(seen.search!.canvas.search!.keys)).toEqual(
      new Set(office.roomRoster.map((room) => room.key)),
    );
    await click(/^Show 2 Codex/);
    expect(seen.search!.canvas.search!.keys).toHaveLength(2);
    await click(/^Stop showing$/);
    expect(seen.search!.canvas.search).toBeNull();

    await click(/^Show 1 plain shell/);
    expect(seen.search!.canvas.search!.keys).toHaveLength(1);
    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(seen.search!.canvas.search).toBeNull();

    // A search takes over the light, and the census lets go.
    await click(/^Show 4 agents/);
    await act(async () => seen.search!.toolbar.onQueryChange("alpha"));
    expect(seen.search!.canvas.census!.lit).toBeNull();
    await act(async () => seen.search!.toolbar.onQueryChange(""));
    expect(seen.search!.canvas.search).toBeNull();
    await act(async () => root.unmount());
    host.remove();
  });
}
