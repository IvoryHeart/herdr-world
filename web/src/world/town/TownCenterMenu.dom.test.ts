import { expect, test } from "bun:test";

if (process.env.TOWN_CENTER_DOM !== "1") {
  test("the town center's menu in an isolated React DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, TOWN_CENTER_DOM: "1" },
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
    PointerEvent: browser.PointerEvent ?? browser.MouseEvent,
    MouseEvent: browser.MouseEvent,
    getComputedStyle: browser.getComputedStyle.bind(browser),
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  const { act, createElement, useState } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { Crown, UserPlus, DoorOpen, Landmark, LibraryBig, Mail } =
    await import("lucide-react");
  const { TownCenterMenu } = await import("./TownCenterMenu");

  function mount() {
    const log: string[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    // The plaque that opened the ring had focus, as when opened by Enter.
    const plaque = document.createElement("button");
    document.body.append(plaque);
    plaque.focus();
    const root = createRoot(host);
    const placed: { menu: HTMLElement; steps: unknown[] }[] = [];
    function Probe() {
      const [open, setOpen] = useState(true);
      if (!open) return null;
      return createElement(TownCenterMenu, {
        viewportWidth: 1440,
        place: (menu: HTMLElement, steps: readonly unknown[]) =>
          placed.push({ menu, steps: [...steps] }),
        onClose: () => {
          log.push("close");
          setOpen(false);
        },
        actions: [
          {
            id: "launch",
            label: "New agent",
            icon: UserPlus,
            primary: true,
            run: () => log.push("launch"),
          },
          {
            id: "master",
            label: "Town master",
            icon: Crown,
            detail: "firstmate",
            run: () => log.push("master"),
          },
          {
            id: "room",
            label: "New room",
            icon: DoorOpen,
            disabled: true,
            detail: "Host is reconnecting",
            run: () => log.push("room"),
          },
          {
            id: "buildings",
            label: "Buildings",
            icon: Landmark,
            ring: () => {
              log.push("ring");
              return [
                {
                  id: "library",
                  label: "Library",
                  icon: LibraryBig,
                  run: () => log.push("library"),
                },
                {
                  id: "post",
                  label: "Post office",
                  icon: Mail,
                  detail: "Needs you",
                  run: () => log.push("post"),
                },
                {
                  id: "annex",
                  label: "Annex",
                  icon: Landmark,
                  ring: () => [
                    {
                      id: "stacks",
                      label: "Stacks",
                      icon: LibraryBig,
                      run: () => log.push("stacks"),
                    },
                  ],
                  run: () => log.push("annex"),
                },
              ];
            },
            run: () => log.push("buildings"),
          },
        ],
      });
    }
    const render = () => act(async () => root.render(createElement(Probe)));
    const buttons = () => [
      ...host.querySelectorAll<HTMLButtonElement>(".town-center-action"),
    ];
    const key = (target: Element, name: string) =>
      act(async () => {
        target.dispatchEvent(
          new KeyboardEvent("keydown", { key: name, bubbles: true }),
        );
      });
    return {
      log,
      host,
      placed,
      render,
      buttons,
      key,
      async close() {
        await act(async () => root.unmount());
        host.remove();
        plaque.remove();
      },
    };
  }

  test("it opens placed on the doors, focused on its first action", async () => {
    const menu = mount();
    await menu.render();
    expect(menu.placed.length).toBe(1);
    const ring = menu.host.querySelector('[role="menu"]')!;
    expect(ring.getAttribute("aria-label")).toBe("Town center");
    expect(document.activeElement).toBe(menu.buttons()[0]!);
    expect(menu.buttons()[1]!.getAttribute("aria-label")).toBe(
      "Town master, firstmate",
    );
    expect(menu.buttons()[2]!.getAttribute("aria-disabled")).toBe("true");
    await menu.close();
  });

  test("arrow keys move around the ring, wrapping at its ends", async () => {
    const menu = mount();
    await menu.render();
    const [first, second, , fourth] = menu.buttons();
    await menu.key(first!, "ArrowRight");
    expect(document.activeElement).toBe(second!);
    await menu.key(second!, "End");
    expect(document.activeElement).toBe(fourth!);
    await menu.key(fourth!, "ArrowDown");
    expect(document.activeElement).toBe(first!);
    await menu.key(first!, "ArrowLeft");
    expect(document.activeElement).toBe(fourth!);
    await menu.close();
  });

  test("choosing closes the ring, then runs; a disabled action does nothing", async () => {
    const menu = mount();
    await menu.render();
    await act(async () => menu.buttons()[2]!.click());
    expect(menu.log).toEqual([]);
    await act(async () => menu.buttons()[1]!.click());
    expect(menu.log).toEqual(["close", "master"]);
    await menu.close();
  });

  test("Escape and the hub close it", async () => {
    const escape = mount();
    await escape.render();
    await escape.key(escape.buttons()[0]!, "Escape");
    expect(escape.log).toEqual(["close"]);
    await escape.close();

    const hub = mount();
    await hub.render();
    const close =
      hub.host.querySelector<HTMLButtonElement>(".town-center-hub")!;
    expect(close.getAttribute("aria-label")).toBe("Close town center");
    await act(async () => close.click());
    expect(hub.log).toEqual(["close"]);
    await hub.close();
  });

  const ring = (menu: ReturnType<typeof mount>) =>
    menu.host.querySelector<HTMLElement>('[role="menu"]')!;
  const action = (menu: ReturnType<typeof mount>, id: string) =>
    menu.host.querySelector<HTMLButtonElement>(
      `.town-center-action[data-action="${id}"]`,
    )!;
  const hub = (menu: ReturnType<typeof mount>) =>
    menu.host.querySelector<HTMLButtonElement>(".town-center-hub")!;

  test("Buildings opens a second ring in place, focused, with Back at its centre", async () => {
    const menu = mount();
    await menu.render();
    const buildings = action(menu, "buildings");
    expect(buildings.getAttribute("aria-haspopup")).toBe("menu");
    await act(async () => buildings.click());
    expect(menu.log).toEqual(["ring"]);
    expect(ring(menu).getAttribute("aria-label")).toBe("Buildings");
    expect(menu.buttons().map((button) => button.dataset.action)).toEqual([
      "library",
      "post",
      "annex",
    ]);
    expect(menu.buttons()[1]!.getAttribute("aria-label")).toBe(
      "Post office, Needs you",
    );
    expect(document.activeElement).toBe(menu.buttons()[0]!);
    expect(hub(menu).getAttribute("aria-label")).toBe("Back to town center");
    expect(hub(menu).dataset.from).toBe("buildings");
    expect(hub(menu).textContent).toBe("Buildings");
    // Arrows move around the second ring as around the first.
    await menu.key(menu.buttons()[0]!, "ArrowRight");
    expect(document.activeElement).toBe(menu.buttons()[1]!);
    await menu.close();
  });

  test("the centre's Back and Escape return to the first ring, focused on Buildings", async () => {
    for (const leave of ["hub", "escape"] as const) {
      const menu = mount();
      await menu.render();
      // Pressed as a pointer does: the layer stack sees the press first.
      const press = (target: HTMLElement) =>
        act(async () => {
          target.dispatchEvent(
            new PointerEvent("pointerdown", { bubbles: true }),
          );
          target.click();
        });
      await press(action(menu, "buildings"));
      if (leave === "hub") await press(hub(menu));
      else await menu.key(menu.buttons()[0]!, "Escape");
      // Still open: only the second ring closed.
      expect(menu.log).toEqual(["ring"]);
      expect(ring(menu).getAttribute("aria-label")).toBe("Town center");
      expect(menu.buttons()).toHaveLength(4);
      expect(document.activeElement).toBe(action(menu, "buildings"));
      expect(hub(menu).getAttribute("aria-label")).toBe("Close town center");
      // A second Escape closes the ring.
      await menu.key(action(menu, "buildings"), "Escape");
      expect(menu.log).toEqual(["ring", "close"]);
      await menu.close();
    }
  });

  test("choosing a building closes the ring, then opens it", async () => {
    const menu = mount();
    await menu.render();
    await act(async () => action(menu, "buildings").click());
    await act(async () => action(menu, "library").click());
    expect(menu.log).toEqual(["ring", "close", "library"]);
    await menu.close();
  });

  const last = (menu: ReturnType<typeof mount>) =>
    menu.placed[menu.placed.length - 1]!;

  test("every ring opens around the entry that opened it, at any depth", async () => {
    const menu = mount();
    await menu.render();
    // The first ring sits on the doors; Buildings is fourth of four.
    expect(menu.placed.map(({ steps }) => steps)).toEqual([[]]);
    await act(async () => action(menu, "buildings").click());
    // Buildings, at the left of the first ring, is the second's centre.
    expect(last(menu).steps).toEqual([{ x: -96, y: 0 }]);
    expect(last(menu).menu).toBe(ring(menu));
    // Annex, third of three, opens a third ring around itself.
    await act(async () => action(menu, "annex").click());
    expect(ring(menu).getAttribute("aria-label")).toBe("Annex");
    expect(ring(menu).dataset.ring).toBe("buildings/annex");
    expect(last(menu).steps).toEqual([
      { x: -96, y: 0 },
      { x: -83, y: 48 },
    ]);
    expect(hub(menu).getAttribute("aria-label")).toBe("Back to Buildings");
    expect(hub(menu).textContent).toBe("Annex");
    // Escape steps back one ring at a time, focused on the entry left.
    await menu.key(menu.buttons()[0]!, "Escape");
    expect(ring(menu).dataset.ring).toBe("buildings");
    expect(document.activeElement).toBe(action(menu, "annex"));
    expect(last(menu).steps).toEqual([{ x: -96, y: 0 }]);
    await menu.key(action(menu, "annex"), "Escape");
    expect(ring(menu).dataset.ring).toBe("town-center");
    expect(document.activeElement).toBe(action(menu, "buildings"));
    expect(last(menu).steps).toEqual([]);
    expect(menu.log).toEqual(["ring"]);
    await menu.key(action(menu, "buildings"), "Escape");
    expect(menu.log).toEqual(["ring", "close"]);
    await menu.close();
  });
}
