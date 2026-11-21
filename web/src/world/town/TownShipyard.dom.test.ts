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
  const { SHIPYARD_REPO_KEY, shipyardStore } = await import(
    "../shipyard/shipyardStore"
  );
  const { worldLocalStorage } = await import("../../browserStorage");
  const {
    FIXTURE_REPO,
    FIXTURE_UNRELEASED,
    shipyardFixtureCatalog,
    shipyardFixtureSnapshot,
  } = await import("../shipyard/shipyardFixture");
  /** The fixture's projects with releases: the ones with a lane. */
  const released = (mode: Mode) =>
    shipyardFixtureCatalog(mode, Date.now()).repositories.filter(
      (repo) => repo !== FIXTURE_UNRELEASED,
    );
  const {
    TOWN_PROJECT_COLORS,
    townHarbourLot,
    townHarbourPlaced,
    townHarbourSignRow,
    townLanePierAt,
    townLanesShown,
  } = await import("./townHarbour");
  const { TownCamera } = await import("./townCamera");
  const T = (await import("./townLayout")).TOWN_TILE;
  type TownRendererHandle = import("./townRenderer").TownRendererHandle;
  type Mode = import("../shipyard/shipyardFixture").ShipyardFixtureMode;
  type Snapshot = import("../../../../shared/shipyard").ShipyardSnapshot;

  // Town's other sources never answer here.
  worldSourcesStore.useFetch(() => new Promise<Response>(() => {}));

  const calls: { path: string; method: string }[] = [];
  let edit: (snapshot: Snapshot) => Snapshot = (snapshot) => snapshot;
  /** When set, World stops answering. */
  let down = false;
  /** Repositories whose reads fail while the others answer. */
  const broken = new Set<string>();
  /** The Shipyard service, answering from the testing fixture. */
  function serve(mode: Mode) {
    // Each test starts with no project chosen on this browser.
    worldLocalStorage.removeItem(SHIPYARD_REPO_KEY);
    shipyardStore.reset();
    calls.length = 0;
    edit = (snapshot) => snapshot;
    down = false;
    broken.clear();
    shipyardStore.useFetch(async (input, init) => {
      const path = String(input);
      calls.push({ path, method: init?.method ?? "GET" });
      if (down) throw new TypeError("Failed to fetch");
      const url = new URL(path, "http://fixture.invalid");
      const repo = url.searchParams.get("repo");
      if (repo && broken.has(repo)) throw new TypeError("Failed to fetch");
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
  async function mount(
    narrow = false,
    renderer: { current: TownRendererHandle | null } = { current: null },
  ) {
    const opened: (string | undefined)[] = [];
    const host = document.createElement("div");
    host.className = "town-world";
    document.body.append(host);
    const root = createRoot(host);
    const layout = town(narrow);
    await act(async () =>
      root.render(
        createElement(
          TownOpenWorkContext.Provider,
          { value: (tab?: string) => void opened.push(tab) },
          createElement(TownShipyard, { layout, renderer }),
        ),
      ),
    );
    await settle();
    const lanes = () => [
      ...host.querySelectorAll<HTMLElement>(
        ".town-harbour-lane:not([data-more])",
      ),
    ];
    const lane = (repo: string) =>
      host.querySelector<HTMLElement>(
        `.town-harbour-lane[aria-label="Shipping lane ${repo}"]`,
      )!;
    return {
      host,
      layout,
      opened,
      lanes,
      lane,
      sign: () => host.querySelector<HTMLButtonElement>(".town-harbour-sign"),
      ships: (repo = FIXTURE_REPO) => [
        ...lane(repo).querySelectorAll<HTMLButtonElement>(".town-harbour-ship"),
      ],
      board: (repo = FIXTURE_REPO) =>
        lane(repo).querySelector<HTMLButtonElement>(".town-harbour-board")!,
      hull: (repo = FIXTURE_REPO) =>
        lane(repo).querySelector<HTMLButtonElement>(".town-harbour-hull"),
      lamp: (repo = FIXTURE_REPO) =>
        lane(repo).querySelector<HTMLElement>(".town-harbour-lamp")!,
      async close() {
        await act(async () => root.unmount());
        host.remove();
      },
    };
  }

  test("one lane per project: board, lighthouse, slipway and ships", async () => {
    serve("ready");
    const harbour = await mount();
    const repos = released("ready");
    expect(harbour.sign()!.getAttribute("aria-label")).toBe(
      `Shipyard: ${repos.length} projects. Open releases`,
    );
    // Every project with releases has its lane, in the catalog's order,
    // each its colour; the suggested project with none has no lane.
    expect(
      harbour.lanes().map((lane) => lane.getAttribute("aria-label")),
    ).toEqual(repos.map((repo) => `Shipping lane ${repo}`));
    expect(shipyardFixtureCatalog("ready", Date.now()).repositories).toContain(
      FIXTURE_UNRELEASED,
    );
    // A pier and a lighthouse for each lane, and no other (#1148).
    expect(harbour.host.querySelectorAll(".town-harbour-pier").length).toBe(
      repos.length,
    );
    for (const lane of harbour.lanes()) {
      expect(lane.querySelectorAll(".town-harbour-pier").length).toBe(1);
      expect(
        lane.querySelector(".town-harbour-lighthouse > .town-harbour-lamp"),
      ).not.toBeNull();
    }
    const colours = harbour
      .lanes()
      .map((lane) => lane.style.getPropertyValue("--lane"));
    expect(new Set(colours).size).toBe(repos.length);
    expect(colours[0]).toBe(TOWN_PROJECT_COLORS[0]);
    expect(harbour.board().getAttribute("aria-label")).toBe(
      `${FIXTURE_REPO}: v1.5.0-rc.1 · 4 waiting · main passing. Open releases`,
    );
    expect(harbour.board().textContent).toBe("widgets");
    expect(harbour.lamp().dataset.tone).toBe("pass");
    expect(harbour.lamp().getAttribute("aria-label")).toStartWith(
      `${FIXTURE_REPO} lighthouse: `,
    );
    // The next release on the slipway, with the merged changes waiting.
    expect(harbour.hull()!.textContent).toBe("4");
    // No pull request is the harbour's: those are the warehouse's.
    expect(harbour.host.querySelector(".town-harbour-crate")).toBeNull();
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
    // Every other project's own releases moor in its own lane.
    for (const repo of repos.slice(1)) {
      expect(harbour.ships(repo).length).toBeGreaterThan(0);
      expect(
        harbour.ships(repo).some((ship) => ship.textContent === "v1.4.0"),
      ).toBe(false);
    }

    // The sign opens the Releases tab; a lane's board opens its project.
    await act(async () => harbour.sign()!.click());
    expect(harbour.opened).toEqual(["releases"]);
    await act(async () => harbour.board(repos[1]).click());
    await settle();
    expect(harbour.opened).toEqual(["releases", "releases"]);
    expect(shipyardStore.state().repo).toBe(repos[1]!);
    await act(async () => harbour.hull()!.click());
    await settle();
    expect(harbour.opened).toEqual(["releases", "releases", "releases"]);
    expect(shipyardStore.state().repo).toBe(FIXTURE_REPO);

    // A ship opens its release; "All releases" opens the whole pipeline.
    await act(async () => harbour.ships()[1]!.click());
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
    expect(harbour.opened.length).toBe(4);
    expect(document.querySelector('[aria-label="Release v1.4.0"]')).toBeNull();
    await harbour.close();
  });

  test("more projects than the sea holds: the last lane lists the rest", async () => {
    serve("many");
    const harbour = await mount();
    const repos = released("many");
    const lot = townHarbourLot(harbour.layout);
    const shown = townLanesShown(lot, repos.length);
    expect(harbour.lanes().length).toBe(shown);
    const more = harbour.host.querySelector<HTMLButtonElement>(
      ".town-harbour-board[data-more]",
    );
    // A town's sea holds fewer lanes than the fixture's projects.
    expect(shown).toBeLessThan(repos.length);
    {
      expect(more!.getAttribute("aria-label")).toBe(
        `${repos.length - shown} more projects. List them`,
      );
      await act(async () => more!.click());
      const list = document.querySelector<HTMLElement>(
        '[role="dialog"][aria-label="More projects"]',
      )!;
      const rows = [...list.querySelectorAll<HTMLButtonElement>("li button")];
      expect(rows.map((row) => row.querySelector("b")!.textContent)).toEqual(
        repos.slice(shown),
      );
      await act(async () => rows[0]!.click());
      await settle();
      expect(harbour.opened).toEqual(["releases"]);
      expect(shipyardStore.state().repo).toBe(repos[shown]!);
    }
    // A main failing somewhere is on the harbour's sign.
    expect(harbour.sign()!.textContent).toContain(`${repos.length} projects`);
    expect(harbour.sign()!.textContent).toContain("main failing");
    await harbour.close();
  });

  test("a newly published release sails in; the first read does not", async () => {
    serve("ready");
    const harbour = await mount();
    expect(
      harbour.host.querySelectorAll(".town-harbour-ship[data-arriving]").length,
    ).toBe(0);
    edit = (snapshot) =>
      snapshot.repo !== FIXTURE_REPO
        ? snapshot
        : {
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
          };
    await settle();
    const ships = harbour.ships();
    expect(ships[0]!.textContent).toBe("v1.5.0");
    expect(ships[0]!.dataset.arriving).toBe("true");
    expect(ships.slice(1).some((ship) => ship.dataset.arriving)).toBe(false);
    // Only the project that released sails a ship in.
    expect(
      harbour.host.querySelectorAll(".town-harbour-ship[data-arriving]").length,
    ).toBe(1);
    expect(harbour.host.textContent).toContain(
      `${FIXTURE_REPO} v1.5.0 released.`,
    );
    await harbour.close();
  });

  test("out of date: everything is old, so the lighthouse is unknown", async () => {
    serve("stale");
    const harbour = await mount();
    expect(harbour.lane(FIXTURE_REPO).dataset.stale).toBe("true");
    expect(harbour.lamp().dataset.tone).toBe("unknown");
    expect(harbour.sign()!.getAttribute("aria-label")).toContain("out of date");
    expect(harbour.board().getAttribute("aria-label")).toContain(
      `${FIXTURE_REPO}: Out of date · `,
    );
    await harbour.close();
  });

  test("one lane's read fails: only that lane is out of date", async () => {
    serve("ready");
    const harbour = await mount();
    const other = shipyardFixtureCatalog("ready", Date.now()).repositories[1]!;
    expect(harbour.lane(other).dataset.stale).toBeUndefined();
    broken.add(other);
    await settle();
    expect(harbour.lane(other).dataset.stale).toBe("true");
    expect(harbour.lamp(other).dataset.tone).toBe("unknown");
    // Its last ships stay, as old.
    expect(harbour.ships(other).length).toBeGreaterThan(0);
    expect(harbour.lane(FIXTURE_REPO).dataset.stale).toBeUndefined();
    await harbour.close();
  });

  test("GitHub off: no releases known, so no lane; the sign says why", async () => {
    serve("off");
    const harbour = await mount();
    expect(harbour.lanes()).toEqual([]);
    for (const part of ["pier", "lighthouse", "ship", "hull", "board"])
      expect(harbour.host.querySelector(`.town-harbour-${part}`)).toBeNull();
    expect(harbour.sign()!.textContent).toContain("GitHub source is off");
    await harbour.close();
  });

  test("a project gets its lane with its first release, and none before", async () => {
    serve("ready");
    const harbour = await mount();
    const repos = released("ready");
    expect(harbour.lanes().length).toBe(repos.length);
    expect(
      harbour.host.querySelector(
        `[aria-label="Shipping lane ${FIXTURE_UNRELEASED}"]`,
      ),
    ).toBeNull();
    edit = (snapshot) =>
      snapshot.repo !== FIXTURE_UNRELEASED || !snapshot.data
        ? snapshot
        : {
            ...snapshot,
            data: {
              ...snapshot.data,
              releases: {
                ...snapshot.data.releases,
                items: [
                  {
                    id: 901,
                    tag: "v0.1.0",
                    version: "0.1.0",
                    name: "v0.1.0",
                    channel: "stable",
                    publishedAt: Date.now(),
                    url: "https://example.com/example-org/notes/releases/tag/v0.1.0",
                  },
                ],
              },
            },
          };
    await settle();
    expect(harbour.lanes().length).toBe(repos.length + 1);
    expect(harbour.ships(FIXTURE_UNRELEASED).map((s) => s.textContent)).toEqual(
      ["v0.1.0"],
    );
    expect(harbour.host.querySelectorAll(".town-harbour-pier").length).toBe(
      repos.length + 1,
    );
    await harbour.close();
  });

  test("before the first read answers, no lane or pier stands", async () => {
    serve("ready");
    shipyardStore.useFetch(() => new Promise<Response>(() => {}));
    const host = document.createElement("div");
    host.className = "town-world";
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        createElement(TownShipyard, {
          layout: town(false),
          renderer: { current: null },
        }),
      ),
    );
    expect(host.querySelector(".town-harbour-lane")).toBeNull();
    expect(host.querySelector(".town-harbour-pier")).toBeNull();
    expect(host.querySelector(".town-harbour-sign")!.textContent).toContain(
      "Opening",
    );
    await act(async () => root.unmount());
    host.remove();
  });

  test("a shortened comparison never shows a complete count", async () => {
    serve("limited");
    const harbour = await mount();
    expect(harbour.hull()!.textContent).toMatch(/^\d+\+$/);
    await harbour.close();
  });

  test("a phone's town has the harbour too, and a signpost that flies there", async () => {
    serve("ready");
    // A phone's camera, at home on the first building.
    const camera = new TownCamera();
    camera.reducedMotion = true;
    const viewport = {
      width: 390,
      height: 760,
      inset: { top: 12, right: 12, bottom: 12, left: 12 },
    };
    const layout = town(true);
    camera.configure(layout, viewport);
    const first = layout.buildings[0]!;
    camera.jumpTo(
      (first.x + first.w / 2) * T,
      first.y * T,
      camera.limits!.home,
    );
    const invalidated: (string | undefined)[] = [];
    const handle = {
      camera,
      invalidate: (reason?: string) => void invalidated.push(reason),
    } as unknown as TownRendererHandle;
    const harbour = await mount(true, { current: handle });
    const repos = released("ready");
    // The harbour itself: its sign and a lane per project, on the sea right
    // of the stacked buildings.
    expect(harbour.sign()).not.toBeNull();
    expect(harbour.lanes().length).toBe(repos.length);
    expect(harbour.ships().length).toBeGreaterThan(0);
    const lot = townHarbourLot(harbour.layout);
    expect(lot.streetEnd).toBeGreaterThan(first.x + first.w);
    // Off-screen at home: the coast lies right of what the phone shows.
    const coast = camera.toScreen(lot.coast * T, 0).x;
    expect(coast).toBeGreaterThan(viewport.width);
    const fold =
      harbour.host.querySelector<HTMLButtonElement>(".town-harbour-fold")!;
    expect(fold.textContent).toContain(`${repos.length}`);
    expect(fold.querySelectorAll(".town-harbour-fold-lanes i").length).toBe(
      repos.length,
    );
    expect(fold.getAttribute("aria-label")).toBe(
      `Shipyard: ${repos.length} projects. Go to the harbour`,
    );
    // The signpost flies to the sea: the promenade and a whole pier across
    // the phone, the harbour's sign at the top.
    await act(async () => fold.click());
    expect(harbour.opened).toEqual([]);
    expect(invalidated).toEqual(["harbour"]);
    const placed = townHarbourPlaced(lot, repos.length);
    const pier = townLanePierAt(placed, 0);
    const from = camera.toScreen(
      lot.streetEnd * T,
      townHarbourSignRow(placed) * T,
    );
    const to = camera.toScreen(pier.x + pier.w, pier.y);
    expect(from.x).toBeGreaterThanOrEqual(viewport.inset.left - 1);
    expect(to.x).toBeLessThanOrEqual(viewport.width - viewport.inset.right + 1);
    expect(from.y).toBeGreaterThanOrEqual(viewport.inset.top - 1);
    expect(to.y).toBeLessThan(viewport.height);
    await harbour.close();
  });

  test("a town drawn alone: the signpost opens the releases", async () => {
    serve("ready");
    const harbour = await mount(true);
    await act(async () =>
      harbour.host
        .querySelector<HTMLButtonElement>(".town-harbour-fold")!
        .click(),
    );
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
      "5 commits on main in all",
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

    // World stops answering: the last read stays, but old, and nothing opens.
    down = true;
    await act(async () =>
      lens
        .querySelector<HTMLButtonElement>('[aria-label="Read GitHub again"]')!
        .click(),
    );
    expect(lens.querySelector(".shipyard-age")!.textContent).toStartWith(
      "Out of date",
    );
    expect(lens.querySelector(".shipyard-stale")!.textContent).toContain(
      "World did not answer",
    );
    expect(stage("Main branch").textContent).not.toContain("main passing");
    expect(stage("Running Worlds").querySelector("a.shipyard-open")).toBeNull();
    expect(stage("Running Worlds").textContent).toContain(
      "0 running, 3 stopped reporting",
    );
    down = false;
    await settle();
    expect(stage("Main branch").textContent).toContain("main passing");

    // Another repository is read and kept on this browser.
    const select = lens.querySelector<HTMLSelectElement>(
      ".shipyard-repo select",
    )!;
    await act(async () => {
      select.value = "example-org/gadgets";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    // The chosen repository is read first, after the catalog.
    const catalogRead = calls
      .map((call) => call.path)
      .lastIndexOf("/api/world/shipyard");
    expect(calls[catalogRead + 1]!.path).toBe(
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
