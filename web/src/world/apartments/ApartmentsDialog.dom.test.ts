import { expect, test } from "bun:test";

if (process.env.APARTMENTS_DOM !== "1") {
  test("Apartments in an isolated React DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, APARTMENTS_DOM: "1" },
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
  }, 30_000);
} else {
  const browser = globalThis.window as unknown as typeof globalThis;
  for (const [key, value] of Object.entries({
    HTMLButtonElement: browser.HTMLButtonElement,
    HTMLInputElement: browser.HTMLInputElement,
    KeyboardEvent: browser.KeyboardEvent,
    CustomEvent: browser.CustomEvent,
    NodeFilter: browser.NodeFilter,
    PointerEvent: browser.PointerEvent ?? browser.MouseEvent,
    MouseEvent: browser.MouseEvent,
    FocusEvent: browser.FocusEvent,
    ResizeObserver: browser.ResizeObserver,
    DOMParser: browser.DOMParser,
    location: browser.location,
    history: browser.history,
    localStorage: browser.localStorage,
    getComputedStyle: browser.getComputedStyle.bind(browser),
    requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
    cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { fixtureApartmentsClient } = await import(
    "../testing/apartmentsFixture"
  );
  const { setApartmentsClient } = await import("./useApartments");
  setApartmentsClient(fixtureApartmentsClient(Date.now()));
  const { ApartmentsDialog, resumeRooms } = await import("./ApartmentsDialog");
  const { fixtureHost, fixtureWorld } = await import("../board/boardFixture");

  const world = fixtureWorld([
    fixtureHost("local", [{ label: "alpha", tabs: [] }]),
  ]);

  async function mount(initialQuery = "") {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let closed = 0;
    await act(async () =>
      root.render(
        createElement(ApartmentsDialog, {
          world,
          initialQuery,
          onOpen: () => undefined,
          onClose: () => (closed += 1),
        }),
      ),
    );
    // The fixture answers on the next tick.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const dialog = () =>
      host.querySelector<HTMLElement>(
        '[role="dialog"][aria-label="Apartments"]',
      )!;
    return {
      dialog,
      names: () =>
        [...host.querySelectorAll(".apartments-row strong")].map(
          (name) => name.textContent,
        ),
      button: (text: string) =>
        [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
          item.textContent?.includes(text),
        )!,
      closed: () => closed,
      async search(text: string) {
        const input = host.querySelector<HTMLInputElement>(
          'input[aria-label="Search residents"]',
        )!;
        await act(async () => {
          const setter = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(input),
            "value",
          )!.set!;
          setter.call(input, text);
          input.dispatchEvent(new window.Event("input", { bubbles: true }));
        });
      },
      async unmount() {
        await act(async () => root.unmount());
        host.remove();
      },
    };
  }

  test("residents list newest first and search covers name, project, summary, PR and date", async () => {
    const view = await mount();
    expect(view.names()).toEqual(["ada", "grace", "linus", "hopper", "turing"]);
    expect(view.dialog().textContent).toContain(
      "5 residents · kept 90 days, up to 500",
    );
    await view.search("#42");
    expect(view.names()).toEqual(["ada"]);
    await view.search("project-beta");
    expect(view.names()).toEqual(["grace", "turing"]);
    await view.search("flaky menu");
    expect(view.names()).toEqual(["hopper"]);
    await view.search("grace");
    expect(view.names()).toEqual(["grace"]);
    const today = new Date(Date.now() - 2 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await view.search(today);
    expect(view.names()).toContain("ada");
    await view.search("nobody-by-this-name");
    expect(view.dialog().textContent).toContain("No resident matches.");
    await view.unmount();
  });

  test("a resident shows what it did, reads its history and can be evicted", async () => {
    const view = await mount("ada");
    await act(async () => view.button("ada").click());
    const text = () => view.dialog().textContent ?? "";
    expect(text()).toContain("/srv/example/project-alpha");
    expect(text()).toContain("Its terminal ended");
    expect(text()).toContain("Opened PR #42; checks are green.");
    const link = view
      .dialog()
      .querySelector<HTMLAnchorElement>('section[aria-label="Linked work"] a')!;
    expect(link.href).toBe("https://example.com/example/project/pull/42");
    expect(link.rel).toBe("noreferrer");
    // Its host is not connected here, so it says where to resume.
    expect(text()).toContain("Connect Fixture host to resume it there.");
    expect(text()).toContain(
      "claude --resume 0f0e0d0c-0000-4000-8000-000000000000",
    );

    await act(async () => view.button("Read history").click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(text()).toContain("Please: Fixed the widget parser and opened a PR");

    await act(async () => view.button("Evict…").click());
    expect(text()).toContain("Forget ada? Its transcript stays on the host.");
    await act(async () => view.button("Evict").click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    // Back on the list, and ada no longer lives here.
    expect(view.names()).toEqual([]);
    await view.search("");
    expect(view.names()).toEqual(["grace", "linus", "hopper", "turing"]);
    await view.unmount();
  });

  test("a resident that never reported its session cannot be resumed", async () => {
    const view = await mount("turing");
    await act(async () => view.button("turing").click());
    expect(view.dialog().textContent).toContain(
      "World cannot resume this agent: it never reported its session.",
    );
    await view.unmount();
  });

  test("Esc goes back to the list, then closes", async () => {
    const view = await mount();
    await act(async () => view.button("grace").click());
    const esc = () =>
      act(async () => {
        document.dispatchEvent(
          new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
    await esc();
    expect(view.names().length).toBeGreaterThan(0);
    expect(view.closed()).toBe(0);
    await esc();
    expect(view.closed()).toBe(1);
    await view.unmount();
  });

  test("resume rooms are the resident's own host, connected and current", () => {
    const stale = fixtureWorld([
      fixtureHost("local", [{ label: "alpha", tabs: [] }], { stale: true }),
    ]);
    expect(
      resumeRooms(world, { connection_id: "local" }).map((room) => room.label),
    ).toEqual(["alpha"]);
    expect(resumeRooms(world, { connection_id: "other" })).toEqual([]);
    expect(resumeRooms(stale, { connection_id: "local" })).toEqual([]);
  });
}
