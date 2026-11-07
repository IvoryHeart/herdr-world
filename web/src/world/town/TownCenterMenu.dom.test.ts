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
  const { Crown, UserPlus, DoorOpen } = await import("lucide-react");
  const { TownCenterMenu } = await import("./TownCenterMenu");

  function mount() {
    const log: string[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const placed: HTMLElement[] = [];
    function Probe() {
      const [open, setOpen] = useState(true);
      if (!open) return null;
      return createElement(TownCenterMenu, {
        viewportWidth: 1440,
        place: (menu: HTMLElement) => placed.push(menu),
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
    const [first, second, third] = menu.buttons();
    await menu.key(first!, "ArrowRight");
    expect(document.activeElement).toBe(second!);
    await menu.key(second!, "End");
    expect(document.activeElement).toBe(third!);
    await menu.key(third!, "ArrowDown");
    expect(document.activeElement).toBe(first!);
    await menu.key(first!, "ArrowLeft");
    expect(document.activeElement).toBe(third!);
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
}
