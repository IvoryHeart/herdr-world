import { expect, test } from "bun:test";

if (process.env.TOWN_LENS_DOM !== "1") {
  test("Town's lens legend and keys in an isolated React DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, TOWN_LENS_DOM: "1" },
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
    HTMLElement: browser.HTMLElement,
    HTMLButtonElement: browser.HTMLButtonElement,
    KeyboardEvent: browser.KeyboardEvent,
    MouseEvent: browser.MouseEvent,
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  const { act, createElement, useRef } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { TownLensLayer, TownLensLegend, useTownLensKeys, useTownLensState } =
    await import("./TownLenses");
  const { townLensView } = await import("./townLens");
  const {
    layoutTown,
    TOWN_TILE: T,
    townShapeFor,
  } = await import("./townLayout");
  const { townModelFromProjection } = await import("./townModel");
  const { townSearchLight } = await import("./townSearch");
  const { town, working } = await import("./scene/townScene.fixture");

  function mount(escapeTaken = false) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    function Probe() {
      const state = useTownLensState();
      const shell = useRef<HTMLDivElement | null>(null);
      useTownLensKeys(state, shell, escapeTaken);
      return createElement(
        "div",
        { ref: shell, "data-lens": state.lens },
        state.shown
          ? createElement(TownLensLegend, { state, view: null, readout: null })
          : createElement("p", { className: "board" }, "TOWN BOARD"),
      );
    }
    act(() => root.render(createElement(Probe)));
    const shell = () => host.firstElementChild as HTMLElement;
    const click = (selector: string) =>
      act(() =>
        (host.querySelector(selector) as HTMLButtonElement).dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        ),
      );
    const key = (keyName: string, shiftKey = false) =>
      act(() => {
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: keyName,
            shiftKey,
            bubbles: true,
          }),
        );
      });
    return { host, root, shell, click, key };
  }

  test("L turns on a lens, steps it, and Escape brings the board back", () => {
    const { host, root, shell, key } = mount();
    expect(shell().dataset.lens).toBe("attention");
    expect(host.querySelector(".board")).not.toBeNull();
    key("l");
    expect(shell().dataset.lens).toBe("idle");
    expect(host.querySelector(".town-lens-legend")).not.toBeNull();
    expect(host.querySelector(".board")).toBeNull();
    key("L");
    expect(shell().dataset.lens).toBe("spend");
    key("L", true);
    expect(shell().dataset.lens).toBe("idle");
    key("Escape");
    expect(shell().dataset.lens).toBe("attention");
    expect(host.querySelector(".board")).not.toBeNull();
    act(() => root.unmount());
    host.remove();
  });

  test("the legend's chooser, ‹ › and ✕", () => {
    const { host, root, shell, key, click } = mount();
    key("l");
    click(".town-lens-name");
    const choices = [
      ...host.querySelectorAll<HTMLButtonElement>(".town-lens-choices button"),
    ].map((button) => button.textContent);
    expect(choices).toEqual([
      "Attention",
      "Idle time",
      "Spend",
      "Pull requests",
      "Quests",
      "Harness",
    ]);
    click(".town-lens-choices button:nth-child(4)");
    expect(shell().dataset.lens).toBe("pulls");
    // Picking closes the chooser.
    expect(host.querySelector(".town-lens-choices")).toBeNull();
    click('[aria-label="Next lens"]');
    expect(shell().dataset.lens).toBe("quests");
    click('[aria-label="Previous lens"]');
    expect(shell().dataset.lens).toBe("pulls");
    click('[aria-label="Leave the lens"]');
    expect(shell().dataset.lens).toBe("attention");
    expect(host.querySelector(".town-lens-legend")).toBeNull();
    // The last lens chosen comes back with L.
    key("l");
    expect(shell().dataset.lens).toBe("pulls");
    act(() => root.unmount());
    host.remove();
  });

  test("typing in a field never switches lenses", () => {
    const { host, root, shell } = mount();
    const input = document.createElement("input");
    shell().append(input);
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "l", bubbles: true }),
      );
    });
    expect(shell().dataset.lens).toBe("attention");
    act(() => root.unmount());
    host.remove();
  });

  test("a search open over a lens takes Escape, and the lens stays", () => {
    const { host, root, shell, key } = mount(true);
    key("l");
    const on = shell().dataset.lens;
    expect(on).not.toBe("attention");
    key("Escape");
    expect(shell().dataset.lens).toBe(on);
    expect(host.querySelector(".town-lens-legend")).not.toBeNull();
    act(() => root.unmount());
    host.remove();
  });

  test("a search's marks sit over the lens's tints and follow an agent", () => {
    const model = townModelFromProjection(
      town({ north: { alpha: working(2) }, south: { beta: working(1) } }),
    );
    const { layout } = layoutTown(
      model.input,
      townShapeFor(1440, 900),
      new Map(),
      new Map(),
    );
    const view = townLensView("idle", model, {
      now: 0,
      activityAt: () => undefined,
      economy: () => ({}) as never,
      work: () => undefined,
      quest: () => undefined,
    })!;
    const room = layout.buildings[0]!.rooms[0]!;
    const agent = [...model.agents.values()].find(
      (candidate) => candidate.roomKey !== room.key,
    )!;
    let at = { x: 100, y: 200, seated: false };
    const frames = new Set<() => void>();
    const source = (light: ReturnType<typeof townSearchLight> | null) => ({
      light,
      actorPosition: (key: string) => (key === agent.key ? at : null),
      follow(place: () => void) {
        frames.add(place);
        return () => void frames.delete(place);
      },
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = (light: ReturnType<typeof townSearchLight> | null) =>
      act(() =>
        root.render(
          createElement(TownLensLayer, {
            view,
            model,
            layout,
            shownRooms: new Set<string>(),
            search: source(light),
          }),
        ),
      );
    const mark = (key: string) =>
      [...host.querySelectorAll<HTMLElement>(".town-lens-search-mark")].find(
        (element) => element.dataset.key === key,
      )!;

    render(townSearchLight(model, [room.key, agent.key], null));
    // Over every room's tint: the marks come after them in the lens layer.
    const lens = host.querySelector(".town-lens")!;
    expect(lens.lastElementChild!.className).toBe("town-lens-search");
    expect(lens.querySelectorAll(".town-lens-search-mark")).toHaveLength(2);
    const roomMark = mark(room.key).style;
    expect([
      roomMark.left,
      roomMark.top,
      roomMark.width,
      roomMark.height,
    ]).toEqual([
      `${room.x * T}px`,
      `${room.y * T}px`,
      `${room.w * T}px`,
      `${room.h * T}px`,
    ]);
    expect([mark(agent.key).style.left, mark(agent.key).style.top]).toEqual([
      "90px",
      "172px",
    ]);
    expect(host.querySelector(".town-lens-search-pulse")).toBeNull();

    // The agent walks: the next frame drawn places its mark again.
    at = { x: 300, y: 400, seated: false };
    for (const place of frames) place();
    expect([mark(agent.key).style.left, mark(agent.key).style.top]).toEqual([
      "290px",
      "372px",
    ]);

    // The chosen match pulses, as a new element for each choice.
    render(
      townSearchLight(model, [room.key, agent.key], { key: room.key, seq: 1 }),
    );
    const pulse = host.querySelector<HTMLElement>(".town-lens-search-pulse")!;
    expect(pulse.dataset.key).toBe(room.key);
    expect(pulse.style.width).toBe(`${room.w * T}px`);
    render(
      townSearchLight(model, [room.key, agent.key], { key: room.key, seq: 2 }),
    );
    expect(host.querySelector(".town-lens-search-pulse")).not.toBe(pulse);

    // Ending the search leaves the lens as it was.
    render(null);
    expect(host.querySelector(".town-lens-search")).toBeNull();
    expect(frames.size).toBe(1);
    act(() => root.unmount());
    expect(frames.size).toBe(0);
    host.remove();
  });
}
