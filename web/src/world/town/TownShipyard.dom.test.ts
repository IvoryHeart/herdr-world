import { expect, test } from "bun:test";

if (process.env.TOWN_SHIPYARD_DOM !== "1") {
  test("the harbour and the Releases tab in an isolated React DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, TOWN_SHIPYARD_DOM: "1" },
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
    HTMLAnchorElement: browser.HTMLAnchorElement,
    KeyboardEvent: browser.KeyboardEvent,
    CustomEvent: browser.CustomEvent,
    NodeFilter: browser.NodeFilter,
    PointerEvent: browser.PointerEvent ?? browser.MouseEvent,
    MouseEvent: browser.MouseEvent,
    FocusEvent: browser.FocusEvent,
    ResizeObserver: browser.ResizeObserver,
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
  const { worldSourcesStore } = await import("../worldSources");
  const { layoutTown, TOWN_SHAPES } = await import("./townLayout");
  const { TownShipyard } = await import("./TownShipyard");
  const { TownOpenWorkContext, TownWorkLens } = await import("./TownWorkLens");
  const { fixtureWorld } = await import("../board/boardFixture");
  const { shipyardStore } = await import("../shipyard/shipyardStore");
  const { shipyardFixtureCatalog, shipyardFixtureSnapshot } = await import(
    "../shipyard/shipyardFixture"
  );
  type Mode = import("../shipyard/shipyardFixture").ShipyardFixtureMode;
  type Snapshot = import("../../../../shared/shipyard").ShipyardSnapshot;

  // Town's other sources never answer here.
  worldSourcesStore.useFetch(() => new Promise<Response>(() => {}));

  const calls: { path: string; method: string }[] = [];
  let edit: (snapshot: Snapshot) => Snapshot = (snapshot) => snapshot;
  /** The Shipyard service, answering from the testing fixture. */
  function serve(mode: Mode) {
    shipyardStore.reset();
    calls.length = 0;
    edit = (snapshot) => snapshot;
    shipyardStore.useFetch(async (input, init) => {
      const path = String(input);
      calls.push({ path, method: init?.method ?? "GET" });
      const url = new URL(path, "http://fixture.invalid");
      const repo = url.searchParams.get("repo");
      const now = Date.now();
      return Response.json(
        repo
          ? edit(shipyardFixtureSnapshot(mode, now, repo))
          : shipyardFixtureCatalog(mode, now),
      );
    });
  }
  const settle = () => act(async () => shipyardStore.read());

  const town = (narrow: boolean) =>
    layoutTown(
      {
        hosts: [{ key: "a", displayOrder: 0 }],
        rooms: [{ key: "a/0", hostKey: "a", order: 0, deskKeys: ["a/0/0"] }],
      },
      narrow ? TOWN_SHAPES.phone : TOWN_SHAPES.wide,
    ).layout;

  /** Mounts the harbour; `opened` records the Work lens tabs it opens. */
  async function mount(narrow = false) {
    const opened: (string | undefined)[] = [];
    const host = document.createElement("div");
    host.className = "town-world";
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        createElement(
          TownOpenWorkContext.Provider,
          { value: (tab?: string) => void opened.push(tab) },
          createElement(TownShipyard, {
            layout: town(narrow),
            renderer: { current: null },
          }),
        ),
      ),
    );
    await settle();
    return {
      host,
      opened,
      sign: () => host.querySelector<HTMLButtonElement>(".town-harbour-sign"),
      ships: () => [
        ...host.querySelectorAll<HTMLButtonElement>(".town-harbour-ship"),
      ],
      crates: () => host.querySelectorAll(".town-harbour-crate").length,
      lamp: () => host.querySelector<HTMLElement>(".town-harbour-lamp")!,
      async close() {
        await act(async () => root.unmount());
        host.remove();
      },
    };
  }

  test("the harbour: lamp, crates and ships from the Shipyard read", async () => {
    serve("ready");
    const harbour = await mount();
    const sign = harbour.sign()!;
    expect(sign.getAttribute("aria-label")).toBe(
      "Shipyard: v1.5.0-rc.1 · 4 waiting · main passing. Open releases",
    );
    expect(harbour.lamp().dataset.tone).toBe("pass");
    expect(harbour.crates()).toBe(4);
    const ships = harbour.ships();
    expect(ships.map((ship) => ship.textContent)).toEqual([
      "v1.5.0-rc.1",
      "v1.4.0",
      "v1.3.2",
    ]);
    expect(ships[0]!.dataset.channel).toBe("prerelease");
    // The installed World runs v1.4.0: its ship flies the pennant.
    expect(ships.map((ship) => ship.dataset.running ?? null)).toEqual([
      null,
      "true",
      null,
    ]);
    expect(ships[1]!.getAttribute("aria-label")).toContain(
      "latest, running on port 19190",
    );
    await act(async () => sign.click());
    expect(harbour.opened).toEqual(["releases"]);
    await act(async () =>
      harbour.host
        .querySelector<HTMLButtonElement>(".town-harbour-cargo")!
        .click(),
    );
    expect(harbour.opened).toEqual(["releases", "releases"]);

    // A ship opens its release; "All releases" opens the whole pipeline.
    await act(async () => ships[1]!.click());
    const card = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Release v1.4.0"]',
    )!;
    const link = card.querySelector<HTMLAnchorElement>("a")!;
    expect(link.href).toBe(
      "https://example.com/example-org/widgets/releases/tag/v1.4.0",
    );
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
    expect(card.textContent).toContain("1 running on this computer.");
    await act(async () =>
      [...card.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "All releases")!
        .click(),
    );
    expect(harbour.opened).toEqual(["releases", "releases", "releases"]);
    expect(document.querySelector('[aria-label="Release v1.4.0"]')).toBeNull();
    await harbour.close();
  });

  test("a newly published release sails in; the first read does not", async () => {
    serve("ready");
    const harbour = await mount();
    expect(harbour.ships().filter((ship) => ship.dataset.arriving)).toEqual([]);
    edit = (snapshot) => ({
      ...snapshot,
      data: snapshot.data && {
        ...snapshot.data,
        releases: {
          ...snapshot.data.releases,
          items: [
            {
              ...snapshot.data.releases.items[0]!,
              id: 7,
              tag: "v1.5.0",
              version: "1.5.0",
              name: "v1.5.0",
              channel: "stable",
              publishedAt: Date.now(),
              url: "https://example.com/example-org/widgets/releases/tag/v1.5.0",
            },
            ...snapshot.data.releases.items,
          ],
        },
      },
    });
    await settle();
    const ships = harbour.ships();
    expect(ships[0]!.textContent).toBe("v1.5.0");
    expect(ships[0]!.dataset.arriving).toBe("true");
    expect(ships.slice(1).some((ship) => ship.dataset.arriving)).toBe(false);
    expect(harbour.host.textContent).toContain("v1.5.0 released.");
    await harbour.close();
  });

  test("out of date: everything is old, so the lamp is unknown", async () => {
    serve("stale");
    const harbour = await mount();
    expect(
      harbour.host.querySelector<HTMLElement>(".town-harbour")!.dataset.stale,
    ).toBe("true");
    expect(harbour.lamp().dataset.tone).toBe("unknown");
    expect(harbour.sign()!.getAttribute("aria-label")).toStartWith(
      "Shipyard: Out of date · ",
    );
    await harbour.close();
  });

  test("GitHub off: no ships, no crates, the sign says why", async () => {
    serve("off");
    const harbour = await mount();
    expect(harbour.ships()).toEqual([]);
    expect(harbour.crates()).toBe(0);
    expect(harbour.host.querySelector(".town-harbour-cargo")).toBeNull();
    expect(harbour.lamp().dataset.tone).toBe("unknown");
    expect(harbour.sign()!.textContent).toContain("GitHub source is off");
    await harbour.close();
  });

  test("a shortened comparison shows a + crate, never a complete count", async () => {
    serve("limited");
    const harbour = await mount();
    expect(harbour.crates()).toBe(6);
    expect(harbour.host.querySelector(".town-harbour-tally")!.textContent).toBe(
      "+",
    );
    await harbour.close();
  });

  test("a narrow town folds it to a sign on the town center", async () => {
    serve("ready");
    const harbour = await mount(true);
    expect(harbour.host.querySelector(".town-harbour")).toBeNull();
    const fold =
      harbour.host.querySelector<HTMLButtonElement>(".town-harbour-fold")!;
    expect(fold.textContent).toBe("v1.5.0-rc.1 · 4 waiting");
    expect(fold.getAttribute("aria-label")).toBe(
      "Shipyard: v1.5.0-rc.1 · 4 waiting · main passing. Open releases",
    );
    await act(async () => fold.click());
    expect(harbour.opened).toEqual(["releases"]);
    await harbour.close();
  });

  test("the Work lens's Releases tab: main, waiting, shipped and running", async () => {
    serve("ready");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        createElement(TownWorkLens, {
          world: fixtureWorld([]),
          tab: "releases",
          onSelectAgent: () => {},
          onClose: () => {},
        }),
      ),
    );
    await settle();
    const lens = host.querySelector<HTMLElement>(".work-lens")!;
    expect(
      lens.querySelector('[role="tab"][aria-selected="true"]')!.textContent,
    ).toBe("Releases");
    expect(document.activeElement?.textContent).toBe("Releases");
    expect(
      [...lens.querySelectorAll<HTMLElement>(".shipyard-stage")].map((stage) =>
        stage.getAttribute("aria-label"),
      ),
    ).toEqual([
      "Main branch",
      "Waiting to ship",
      "Shipped releases",
      "Running Worlds",
    ]);
    expect(lens.querySelector(".work-lens-columns")).toBeNull();
    const stage = (label: string) =>
      lens.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
    expect(stage("Main branch").textContent).toContain("main passing");
    expect(stage("Waiting to ship").textContent).toContain(
      "4 waiting since v1.4.0",
    );
    expect(stage("Waiting to ship").textContent).toContain(
      "1 direct commit on main",
    );
    expect(
      stage("Shipped releases").querySelectorAll(".shipyard-ship").length,
    ).toBe(5);
    // Only fresh reports open; the stale preview has no Open.
    const open = [
      ...stage("Running Worlds").querySelectorAll<HTMLAnchorElement>(
        "a.shipyard-open",
      ),
    ];
    expect(open.map((link) => link.getAttribute("aria-label"))).toEqual([
      "Open World v1.4.0 on port 19190",
      "Open World v1.5.0-dev on port 19191",
    ]);
    expect(open[0]!.href).toBe("http://127.0.0.1:19190/");
    expect(open[0]!.target).toBe("_blank");
    expect(stage("Running Worlds").textContent).toContain(
      "2 running, 1 stopped reporting",
    );

    // Read GitHub again asks the service to refresh; nothing else posts.
    await act(async () =>
      lens
        .querySelector<HTMLButtonElement>('[aria-label="Read GitHub again"]')!
        .click(),
    );
    await settle();
    expect(calls.filter((call) => call.method === "POST")).toEqual([
      {
        path: "/api/world/shipyard/refresh?repo=example-org%2Fwidgets",
        method: "POST",
      },
    ]);

    // Another repository is read and kept on this browser.
    const select = lens.querySelector<HTMLSelectElement>(
      ".shipyard-repo select",
    )!;
    await act(async () => {
      select.value = "example-org/gadgets";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(calls[calls.length - 1]!.path).toBe(
      "/api/world/shipyard?repo=example-org%2Fgadgets",
    );
    expect(select.value).toBe("example-org/gadgets");

    // Pull requests: the kanban returns, the pipeline goes.
    await act(async () =>
      [...lens.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
        .find((tab) => tab.textContent === "Pull requests")!
        .click(),
    );
    expect(lens.querySelector(".shipyard")).toBeNull();
    expect(lens.querySelector(".work-lens-columns")).not.toBeNull();
    await act(async () => root.unmount());
    host.remove();
  });
}
