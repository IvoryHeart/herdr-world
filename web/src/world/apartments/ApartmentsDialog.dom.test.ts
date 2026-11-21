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
  const { fixtureLoglessResident, fixtureResidents } = await import(
    "../testing/apartmentsFixture"
  );
  const { bridge } = await import("../../api");
  const { resetUsageFixture } = await import("../usage/usageFixture");
  const { resetUsageStores } = await import("../usage/usageStore");
  const { provideUsageOpener } = await import("../usage/usageOpener");
  // The service is never reached: usage reads fail unless the fixture is on.
  bridge.call = (async () => {
    throw new Error("no service in this test");
  }) as typeof bridge.call;
  /** `?usageFixture` as a page load: usage reads answer synthetic runs. */
  function usageFixtureOn(on: boolean) {
    history.replaceState(null, "", on ? "/?usageFixture" : "/");
    resetUsageFixture();
    resetUsageStores();
  }
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
    expect(view.names()).toEqual([
      "ada",
      "grace",
      "linus",
      "hopper",
      "lovelace",
      "turing",
    ]);
    expect(view.dialog().textContent).toContain(
      "6 residents · up to 5000, newest kept",
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

  test("every resident shows an avatar on its colour with its harness icon, kept or nearest", async () => {
    const view = await mount();
    const rows = [
      ...view.dialog().querySelectorAll<HTMLElement>(".apartments-row"),
    ];
    const avatars = rows.map((row) => {
      const avatar = row.querySelector<HTMLElement>(".apartments-avatar")!;
      return {
        name: row.querySelector("strong")!.textContent,
        source: avatar.dataset.avatarSource,
        sprite: !!avatar.querySelector("canvas.profile-sprite"),
        harness:
          avatar.querySelector<HTMLElement>(".agent-icon")?.dataset.agent,
        colour: avatar.style.getPropertyValue("--agent-colour"),
        title: avatar.title,
      };
    });
    // No profiles are loaded here: a resident whose look was not kept gets
    // World's default (residentLook.test.ts covers profile and harness).
    expect(avatars).toEqual([
      {
        name: "ada",
        source: "own",
        sprite: true,
        harness: "claude",
        colour: "#9a7555",
        title: "",
      },
      {
        name: "grace",
        source: "own",
        sprite: true,
        harness: "codex",
        colour: "#83759f",
        title: "",
      },
      {
        name: "linus",
        source: "own",
        sprite: true,
        harness: "claude",
        colour: "#4b8a87",
        title: "",
      },
      {
        name: "hopper",
        source: "default",
        sprite: true,
        harness: "codex",
        colour: "",
        title: "World's default avatar",
      },
      {
        name: "lovelace",
        source: "default",
        sprite: true,
        harness: "codex",
        colour: "#5f80a3",
        title: "World's default avatar",
      },
      {
        name: "turing",
        source: "default",
        sprite: true,
        harness: "pi",
        colour: "",
        title: "World's default avatar",
      },
    ]);
    // The opened resident shows the same avatar, larger.
    await act(async () => view.button("turing").click());
    const head = view
      .dialog()
      .querySelector<HTMLElement>(
        ".apartments-detail-head .apartments-avatar",
      )!;
    expect(head.dataset.large).toBe("true");
    expect(head.dataset.avatarSource).toBe("default");
    expect(head.querySelector("canvas.profile-sprite")).not.toBeNull();
    expect(view.dialog().textContent).toContain(
      "Pi · project-beta · Fixture core",
    );
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
    expect(view.names()).toEqual([
      "grace",
      "linus",
      "hopper",
      "lovelace",
      "turing",
    ]);
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

  test("agents found in harness histories live here asleep; a long list shows the newest", async () => {
    const now = Date.now();
    const asleep = Array.from({ length: 250 }, (_, index) => ({
      ...fixtureResidents(now)[0]!,
      id: `r-found${index}`,
      name: "claude",
      room: null,
      move_out: "found" as const,
      terminal_id: `session:0f0e0d0c-0000-4000-8000-1${String(index).padStart(11, "0")}`,
      session_id: `0f0e0d0c-0000-4000-8000-1${String(index).padStart(11, "0")}`,
      moved_out_at: now - (30 + index) * 24 * 60 * 60 * 1000,
      summary: `Asleep task ${index}`,
      last_report: null,
      links: [],
    }));
    setApartmentsClient(fixtureApartmentsClient(now, asleep));
    const view = await mount();
    expect(view.names()).toHaveLength(200);
    expect(view.dialog().textContent).toContain(
      "256 residents · up to 5000, newest kept · newest 200 shown; search to find older",
    );
    await view.search("Asleep task 249");
    expect(view.names()).toEqual(["claude"]);
    await act(async () => view.button("claude").click());
    const text = view.dialog().textContent ?? "";
    expect(text).toContain("Asleep: found in its harness's history");
    expect(text).toContain(
      "claude --resume 0f0e0d0c-0000-4000-8000-100000000249",
    );
    await view.unmount();
    setApartmentsClient(fixtureApartmentsClient(Date.now()));
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

  test("each resident shows its own week of usage; unknown and not-available say so", async () => {
    usageFixtureOn(true);
    const now = Date.now();
    setApartmentsClient(
      fixtureApartmentsClient(now, [fixtureLoglessResident(now)]),
    );
    const view = await mount();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const lines = () =>
      Object.fromEntries(
        [...view.dialog().querySelectorAll(".apartments-list li")].map(
          (item) => [
            item.querySelector(".apartments-row strong")!.textContent,
            {
              text: item.querySelector(".apartments-usage")?.textContent,
              tag: item.querySelector(".apartments-usage")?.tagName,
            },
          ],
        ),
      );
    const shown = lines();
    expect(shown.ada!.text).toMatch(
      /^This week: at work .+ · waited on you .+ · .+ tokens$/,
    );
    // Two runs of linus (a resumed session) add up.
    expect(shown.linus!.text).toBe(
      "This week: at work 5 h · waited on you 0 min · 14M tokens",
    );
    // A resident World never counted (from before, or found asleep).
    expect(shown.hopper).toEqual({
      text: "This week: usage unknown",
      tag: "P",
    });
    expect(shown.hamilton!.text).toEndWith(
      "tokens and cost not available for this harness",
    );
    // Outside Town nothing opens Usage, so the line is text.
    expect(shown.ada!.tag).toBe("P");
    await view.unmount();
    setApartmentsClient(fixtureApartmentsClient(Date.now()));
    usageFixtureOn(false);
  });

  test("in Town a resident's line closes Apartments and opens Breakdown on that agent", async () => {
    usageFixtureOn(true);
    const opened: unknown[][] = [];
    const unregister = provideUsageOpener((...args) => {
      opened.push(args);
    });
    const view = await mount();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const line = () =>
      view
        .dialog()
        .querySelector<HTMLButtonElement>(
          'button.apartments-usage[aria-label$="Open ada in Usage"]',
        );
    expect(line()).not.toBeNull();
    await act(async () => line()!.click());
    expect(view.closed()).toBe(1);
    expect(opened).toEqual([
      ["breakdown", { ids: ["fixture-agent-5"], label: "ada" }],
    ]);
    // A resident with no usage this week still opens its own Breakdown.
    const hopper = view
      .dialog()
      .querySelector<HTMLButtonElement>(
        'button.apartments-usage[aria-label$="Open hopper in Usage"]',
      );
    expect(hopper?.textContent).toBe("This week: usage unknown");
    await act(async () => hopper!.click());
    expect(opened[opened.length - 1]).toEqual([
      "breakdown",
      { ids: [], label: "hopper" },
    ]);
    // The opened resident shows the same line under its heading.
    await act(async () => view.button("grace").click());
    const detail = view
      .dialog()
      .querySelector(".apartments-detail-head .apartments-usage");
    expect(detail?.textContent).toStartWith("This week: at work");
    unregister();
    await view.unmount();
    usageFixtureOn(false);
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
