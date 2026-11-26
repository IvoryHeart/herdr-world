import { expect, test } from "bun:test";

if (process.env.TOWN_WAREHOUSE_DOM !== "1") {
  test("the warehouse in an isolated React DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, TOWN_WAREHOUSE_DOM: "1" },
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
    KeyboardEvent: browser.KeyboardEvent,
    CustomEvent: browser.CustomEvent,
    NodeFilter: browser.NodeFilter,
    PointerEvent: browser.PointerEvent ?? browser.MouseEvent,
    MouseEvent: browser.MouseEvent,
    FocusEvent: browser.FocusEvent,
    ResizeObserver: browser.ResizeObserver,
    getComputedStyle: browser.getComputedStyle.bind(browser),
    requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
    cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
    // Settings' lazy IDE rows keep their reload guard in session storage.
    localStorage: browser.localStorage,
    sessionStorage: browser.sessionStorage,
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { fixturePullRequest } = await import("../testing/pullRequestFixture");
  const { worldSourcesStore } = await import("../worldSources");
  const { WORLD_INTEGRATIONS_EVENT } = await import("../../integrations");
  const { layoutTown, TOWN_SHAPES } = await import("./townLayout");
  const { TownWarehouse, TOWN_WAREHOUSE_LEAVE_MS } = await import(
    "./TownWarehouse"
  );
  const { TownOpenWorkContext, TownWorkLens } = await import("./TownWorkLens");
  const { TownPlaces } = await import("./townPlaces");
  const { TownPlacesContext } = await import("./useTownPlace");
  const { fixtureWorld } = await import("../board/boardFixture");
  const { PULL_REQUEST_LANES } = await import(
    "../../../../shared/worldSources"
  );
  type Snapshot =
    import("../../../../shared/worldSources").WorldSourcesSnapshot;
  type Item = import("../../../../shared/worldSources").WorkItem;

  // The store never reaches a service here; tests publish what it read.
  worldSourcesStore.useFetch(() => new Promise<Response>(() => {}));

  const town = (narrow: boolean) =>
    layoutTown(
      {
        hosts: [{ key: "a", displayOrder: 0 }],
        rooms: [{ key: "a/0", hostKey: "a", order: 0, deskKeys: ["a/0/0"] }],
      },
      narrow ? TOWN_SHAPES.phone : TOWN_SHAPES.wide,
    ).layout;

  function source(
    state: "connected" | "not_connected" | "disabled",
    detail = "Up to date",
  ) {
    return {
      id: "github" as const,
      label: "GitHub",
      enabled: state !== "disabled",
      state,
      detail,
      checkedAt: Date.now(),
      lastSuccessAt: state === "connected" ? Date.now() : null,
      itemCount: 0,
      config: { kind: "github" as const, mergedDays: 7 },
    };
  }

  const publish = (
    items: Item[],
    state: Parameters<typeof source>[0] = "connected",
    detail?: string,
  ) =>
    act(async () =>
      worldSourcesStore.publishSettled({
        observedAt: Date.now(),
        refreshing: false,
        sources: [source(state, detail)],
        items,
        links: [],
        actions: [],
      } satisfies Snapshot),
    );

  /** Mounts the warehouse; `work` stands for Town's Work lens. */
  async function mount(narrow = false, work: (() => void) | null = null) {
    const host = document.createElement("div");
    host.className = "town-world";
    document.body.append(host);
    const root = createRoot(host);
    const places = new TownPlaces();
    await act(async () =>
      root.render(
        createElement(
          TownPlacesContext.Provider,
          { value: places },
          createElement(
            TownOpenWorkContext.Provider,
            { value: work },
            createElement(TownWarehouse, {
              layout: town(narrow),
              renderer: { current: null },
            }),
          ),
        ),
      ),
    );
    return {
      places,
      host,
      sign: () => host.querySelector<HTMLButtonElement>(".town-warehouse-sign"),
      parcels: () => [
        ...host.querySelectorAll<HTMLButtonElement>(
          "button.town-warehouse-parcel",
        ),
      ],
      async close() {
        await act(async () => root.unmount());
        host.remove();
      },
    };
  }

  test("signed out, it is quiet and says how to connect: no parcels, no zeros", async () => {
    await publish([], "not_connected", "Sign in with gh auth login.");
    const office = await mount();
    const sign = office.sign()!;
    expect(sign.getAttribute("aria-label")).toBe(
      "Warehouse: Closed · connect GitHub in Integrations",
    );
    expect(sign.title).toBe("Sign in with gh auth login.");
    expect(sign.textContent).not.toMatch(/\d/);
    expect(office.parcels()).toEqual([]);
    // Integrations opens in Town's one window (#1170), not in Settings.
    let settings = 0;
    const onSettings = () => (settings += 1);
    window.addEventListener(WORLD_INTEGRATIONS_EVENT, onSettings);
    await act(async () => sign.click());
    window.removeEventListener(WORLD_INTEGRATIONS_EVENT, onSettings);
    expect(settings).toBe(0);
    const frame = () =>
      document.querySelector<HTMLElement>(
        '.modal.place-window[data-place-window="integrations"]',
      );
    expect(frame()?.getAttribute("aria-label")).toBe("Integrations");
    await act(async () =>
      frame()!
        .querySelector<HTMLButtonElement>(
          '.place-window-head [aria-label="Close Integrations"]',
        )!
        .click(),
    );
    expect(frame()).toBeNull();
    // The building itself opens the same window as its sign.
    await act(async () => {
      office.places.open("warehouse");
    });
    expect(frame()).not.toBeNull();
    // A press on dimmed Town around the window closes it.
    await act(async () => {
      frame()!.parentElement!.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
    });
    expect(frame()).toBeNull();
    await publish([fixturePullRequest(9)], "disabled");
    expect(office.sign()!.textContent).toContain("GitHub source is off");
    expect(office.parcels()).toEqual([]);
    await office.close();
  });

  test("parcels stand ready first and open the pull request card; a merged one is posted", async () => {
    const items = [
      fixturePullRequest(3, { checks: "pending", updatedAt: 9 }),
      fixturePullRequest(1, { title: "Synthetic ready change" }),
      fixturePullRequest(2, { checks: "fail", lane: "fixing" }),
    ];
    await publish(items);
    const office = await mount();
    expect(office.sign()!.getAttribute("aria-label")).toBe(
      "Warehouse: 1 ready to merge, 1 failing, 1 waiting",
    );
    expect(
      [...office.sign()!.querySelectorAll("[data-state]")].map(
        (part) => part.textContent,
      ),
    ).toEqual(["1 ready", "1 failing", "1 waiting"]);
    const parcels = office.parcels();
    expect(parcels.map((parcel) => parcel.dataset.state)).toEqual([
      "ready",
      "failing",
      "waiting",
    ]);
    expect(parcels[0]!.getAttribute("aria-label")).toBe(
      "#1 Synthetic ready change, example-org/web-app, ready to merge. Open pull request",
    );
    expect(parcels[0]!.textContent).toContain("#1 Synthetic ready change");
    // Its sign takes keyboard users into the yard.
    await act(async () => office.sign()!.click());
    expect(document.activeElement).toBe(parcels[0]!);
    await act(async () => parcels[0]!.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-label")).toBe(
      "Pull request example-org/web-app#1",
    );
    expect(dialog.querySelector(".pr-card")).not.toBeNull();
    expect(dialog.textContent).toContain("Merge…");

    // GitHub reports it merged: it leaves the yard, carried off.
    await publish([{ ...items[1]!, lane: "merged" }, items[0]!, items[2]!]);
    expect(office.parcels().map((parcel) => parcel.dataset.state)).toEqual([
      "failing",
      "waiting",
    ]);
    const leaving = office.host.querySelector<HTMLElement>("[data-leaving]")!;
    expect(leaving.dataset.leaving).toBe("loaded");
    expect(leaving.getAttribute("aria-hidden")).toBe("true");
    expect(office.host.querySelector('[role="status"]')!.textContent).toBe(
      "#1 Synthetic ready change merged.",
    );
    // The card stays on the merged pull request.
    expect(document.querySelector('[role="dialog"] .pr-card')).not.toBeNull();
    await act(
      () =>
        new Promise((resolve) =>
          setTimeout(resolve, TOWN_WAREHOUSE_LEAVE_MS + 50),
        ),
    );
    expect(office.host.querySelector("[data-leaving]")).toBeNull();
    // A closed pull request just goes.
    await publish([items[0]!]);
    expect(
      office.host.querySelector<HTMLElement>("[data-leaving]")!.dataset.leaving,
    ).toBe("gone");
    await office.close();
  });

  test("more than the yard holds make a pile with its count", async () => {
    await publish(
      Array.from({ length: 30 }, (_, index) =>
        fixturePullRequest(index + 1, { checks: "pending" }),
      ),
    );
    const office = await mount();
    expect(office.parcels().length).toBe(20);
    const pile = office.host.querySelector<HTMLButtonElement>(
      ".town-warehouse-pile",
    )!;
    expect(pile.textContent).toBe("+10");
    expect(pile.getAttribute("aria-label")).toBe("10 more pull requests");
    await office.close();
  });

  test("a narrow town keeps it on the shore with its own sign, no fold (#1351)", async () => {
    await publish([
      fixturePullRequest(1),
      fixturePullRequest(2, { draft: true }),
    ]);
    const office = await mount(true);
    // The warehouse stands on the harbour's shore, as on a wide town, with
    // the same sign and counts; the town center carries no sign for it.
    const sign = office.sign()!;
    expect(sign.getAttribute("aria-label")).toBe(
      "Warehouse: 1 ready to merge, 0 failing, 0 waiting, 1 draft",
    );
    expect(office.parcels().length).toBe(2);
    expect(office.host.querySelector(".town-warehouse-fold")).toBeNull();
    await office.close();
  });

  test("in Town, its sign and both lists open every pull request in the Work lens", async () => {
    await publish(
      Array.from({ length: 30 }, (_, index) =>
        fixturePullRequest(index + 1, { checks: "pending" }),
      ),
    );
    let opened = 0;
    const work = () => {
      opened += 1;
    };
    const office = await mount(false, work);
    const sign = office.sign()!;
    expect(sign.getAttribute("aria-label")).toBe(
      "Warehouse: 0 ready to merge, 0 failing, 30 waiting. Open all pull requests",
    );
    await act(async () => sign.click());
    expect(opened).toBe(1);
    // The pile's list leads with every pull request, not only its own.
    await act(async () =>
      office.host
        .querySelector<HTMLButtonElement>(".town-warehouse-pile")!
        .click(),
    );
    const pileList = document.querySelector(".town-warehouse-popover")!;
    const all = pileList.querySelector<HTMLButtonElement>(
      ".town-warehouse-all",
    )!;
    expect(pileList.firstElementChild).toBe(all);
    expect(all.textContent).toBe("All pull requests");
    await act(async () => all.click());
    expect(opened).toBe(2);
    expect(document.querySelector(".town-warehouse-popover")).toBeNull();
    await office.close();

    // On a phone the same sign opens them too (#1351).
    const narrow = await mount(true, work);
    await act(async () => narrow.sign()!.click());
    expect(opened).toBe(3);
    await narrow.close();

    // Without GitHub, the sign still says how to connect and opens Integrations.
    await publish([], "not_connected", "Sign in with gh auth login.");
    const closed = await mount(false, work);
    expect(closed.sign()!.getAttribute("aria-label")).toBe(
      "Warehouse: Closed · connect GitHub in Integrations",
    );
    await act(async () => closed.sign()!.click());
    const integrations = document.querySelector<HTMLElement>(
      '.modal.place-window[data-place-window="integrations"]',
    );
    expect([integrations !== null, opened]).toEqual([true, 3]);
    await closed.close();
  });

  test("before GitHub answers, the sign does not open the Work lens", async () => {
    // A cold page: the first sources request has not returned any source.
    await act(async () =>
      worldSourcesStore.publishSettled({
        observedAt: Date.now(),
        refreshing: true,
        sources: [],
        items: [],
        links: [],
        actions: [],
      } satisfies Snapshot),
    );
    let opened = 0;
    const office = await mount(false, () => {
      opened += 1;
    });
    const sign = office.sign()!;
    expect(sign.getAttribute("aria-label")).not.toContain(
      "Open all pull requests",
    );
    await act(async () => sign.click());
    expect(opened).toBe(0);
    await office.close();
  });

  test("Town's Work lens is Board's kanban, over the warehouse's pull requests", async () => {
    await publish([
      fixturePullRequest(1, { title: "Synthetic ready change" }),
      fixturePullRequest(2, { checks: "fail", lane: "fixing" }),
    ]);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let closed = 0;
    await act(async () =>
      root.render(
        createElement(TownWorkLens, {
          world: fixtureWorld([]),
          onSelectAgent: () => {},
          onClose: () => {
            closed += 1;
          },
        }),
      ),
    );
    // Town's one window frames it (#1170), outside the Town it covers.
    const frame = document.querySelector<HTMLElement>(
      '.modal.place-window[data-place-window="work"]',
    )!;
    const lens = frame.querySelector<HTMLElement>(".work-lens.town-work")!;
    expect(
      [...lens.querySelectorAll<HTMLElement>(".work-lens-column")].map(
        (column) => column.dataset.lane,
      ),
    ).toEqual([...PULL_REQUEST_LANES]);
    expect(
      lens.querySelector('.work-lens-column[data-lane="fixing"]')!.textContent,
    ).toContain("#2");
    expect(lens.textContent).toContain("Synthetic ready change");
    // Keys carry on in the lens, not the sign beneath it.
    expect(document.activeElement?.textContent).toBe("Pull requests");
    // One close, the frame's: the lens draws none of its own.
    expect(frame.querySelectorAll('[aria-label="Close Work"]').length).toBe(1);
    expect(lens.querySelector('[aria-label="Close Work"]')).toBeNull();
    await act(async () =>
      frame
        .querySelector<HTMLButtonElement>(
          '.place-window-head [aria-label="Close Work"]',
        )!
        .click(),
    );
    expect(closed).toBe(1);
    await act(async () => root.unmount());
    host.remove();
  });
}
