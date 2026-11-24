import { expect, test } from "bun:test";

if (process.env.TOWN_BUILDINGS_DOM !== "1") {
  test("the Buildings ring's places in an isolated React DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, TOWN_BUILDINGS_DOM: "1" },
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
    CustomEvent: browser.CustomEvent,
    MouseEvent: browser.MouseEvent,
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
  const { bridge } = await import("../../api");
  // The service is never reached.
  bridge.call = (async () => {
    throw new Error("no service in this test");
  }) as typeof bridge.call;
  const { fixtureApartmentsClient } = await import(
    "../testing/apartmentsFixture"
  );
  const { setApartmentsClient } = await import("../apartments/useApartments");
  setApartmentsClient(fixtureApartmentsClient(Date.now()));
  const { WORLD_APARTMENTS_EVENT } = await import(
    "../apartments/apartmentsStore"
  );
  const { layoutTown } = await import("./townLayout");
  const { TOWN_SHAPES } = await import("./townShape");
  const { townObservatoryLot } = await import("./townObservatoryLot");
  const { TownObservatory } = await import("./TownObservatory");
  const { TownApartments } = await import("./TownApartments");
  const { TownOpenUsageContext } = await import("./TownUsageLens");
  const { TownPlaces } = await import("./townPlaces");
  const { TownPlacesContext } = await import("./useTownPlace");
  const { townCenterBuildings } = await import("./townCenterBuildings");

  const town = (shape: (typeof TOWN_SHAPES)[keyof typeof TOWN_SHAPES]) =>
    layoutTown(
      {
        hosts: [{ key: "a", displayOrder: 0 }],
        rooms: [{ key: "a/0", hostKey: "a", order: 0, deskKeys: ["a/0/0"] }],
      },
      shape,
    ).layout;

  test("a phone's folded observatory still opens Usage from the Buildings ring", async () => {
    const layout = town(TOWN_SHAPES.phone);
    // A phone folds the observatory to a sign: it has no building.
    expect(townObservatoryLot(layout)).toBeNull();
    const usage: string[] = [];
    let opened = 0;
    const onApartments = () => {
      opened += 1;
    };
    window.addEventListener(WORLD_APARTMENTS_EVENT, onApartments);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const places = new TownPlaces();
    await act(async () =>
      root.render(
        createElement(
          TownPlacesContext.Provider,
          { value: places },
          createElement(
            TownOpenUsageContext.Provider,
            {
              value: (tab?: string) => {
                usage.push(tab ?? "");
              },
            },
            createElement(TownObservatory, { layout, agents: new Map() }),
            createElement(TownApartments, { layout }),
          ),
        ),
      ),
    );
    const ring = townCenterBuildings(places);
    expect(ring.map((action) => action.id)).toEqual([
      "apartments",
      "observatory",
    ]);
    // The ring's entry and the folded sign open the same place.
    ring.find((action) => action.id === "observatory")!.run();
    host.querySelector<HTMLButtonElement>(".town-observatory-fold")!.click();
    expect(usage).toEqual(["budget", "budget"]);
    ring.find((action) => action.id === "apartments")!.run();
    expect(opened).toBe(1);
    window.removeEventListener(WORLD_APARTMENTS_EVENT, onApartments);
    await act(async () => root.unmount());
    host.remove();
  });
}
