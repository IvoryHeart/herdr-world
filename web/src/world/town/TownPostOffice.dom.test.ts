import { expect, test } from "bun:test";

if (process.env.TOWN_POST_DOM !== "1") {
  test("the post office in an isolated React DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, TOWN_POST_DOM: "1" },
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
    PointerEvent: browser.PointerEvent ?? browser.MouseEvent,
    MouseEvent: browser.MouseEvent,
    FocusEvent: browser.FocusEvent,
    ResizeObserver: browser.ResizeObserver,
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
  const { fixturePullRequest } = await import("../testing/pullRequestFixture");
  const { worldSourcesStore } = await import("../worldSources");
  const { WORLD_SOURCES_SETTINGS_EVENT } = await import(
    "../../workspaceResource"
  );
  const { layoutTown, TOWN_SHAPES } = await import("./townLayout");
  const { TownPostOffice, TOWN_POST_LEAVE_MS } = await import(
    "./TownPostOffice"
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

  async function mount(narrow = false) {
    const host = document.createElement("div");
    host.className = "town-world";
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        createElement(TownPostOffice, {
          layout: town(narrow),
          renderer: { current: null },
        }),
      ),
    );
    return {
      host,
      sign: () => host.querySelector<HTMLButtonElement>(".town-post-sign"),
      parcels: () => [
        ...host.querySelectorAll<HTMLButtonElement>("button.town-post-parcel"),
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
      "Post office: Closed · connect GitHub in Sources",
    );
    expect(sign.title).toBe("Sign in with gh auth login.");
    expect(sign.textContent).not.toMatch(/\d/);
    expect(office.parcels()).toEqual([]);
    let opened = 0;
    const onSettings = () => (opened += 1);
    window.addEventListener(WORLD_SOURCES_SETTINGS_EVENT, onSettings);
    await act(async () => sign.click());
    window.removeEventListener(WORLD_SOURCES_SETTINGS_EVENT, onSettings);
    expect(opened).toBe(1);
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
      "Post office: 1 ready to merge, 1 failing, 1 waiting",
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
    expect(leaving.dataset.leaving).toBe("posted");
    expect(leaving.getAttribute("aria-hidden")).toBe("true");
    expect(office.host.querySelector('[role="status"]')!.textContent).toBe(
      "#1 Synthetic ready change merged.",
    );
    // The card stays on the merged pull request.
    expect(document.querySelector('[role="dialog"] .pr-card')).not.toBeNull();
    await act(
      () =>
        new Promise((resolve) => setTimeout(resolve, TOWN_POST_LEAVE_MS + 50)),
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
    const pile =
      office.host.querySelector<HTMLButtonElement>(".town-post-pile")!;
    expect(pile.textContent).toBe("+10");
    expect(pile.getAttribute("aria-label")).toBe("10 more pull requests");
    await office.close();
  });

  test("a narrow town folds it to a sign on the town center", async () => {
    await publish([
      fixturePullRequest(1),
      fixturePullRequest(2, { draft: true }),
    ]);
    const office = await mount(true);
    expect(office.sign()).toBeNull();
    expect(office.parcels()).toEqual([]);
    const fold =
      office.host.querySelector<HTMLButtonElement>(".town-post-fold")!;
    expect(fold.getAttribute("aria-label")).toBe(
      "Post office: 1 ready to merge, 0 failing, 0 waiting, 1 draft. Open",
    );
    // A pillar box marks the folded sign, as one stands by the house door.
    expect(fold.querySelector(".town-post-box")).not.toBeNull();
    await office.close();
  });
}
