import { expect, test } from "bun:test";

if (process.env.BOARD_HUB_DOM !== "1") {
  test("Board's hub in an isolated React DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, BOARD_HUB_DOM: "1" },
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
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { Crown, DoorOpen, Inbox, UserPlus } = await import("lucide-react");
  const { BoardHubDock } = await import("./BoardHub");

  function mount() {
    const log: string[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const actions = [
      {
        id: "launch",
        label: "New agent",
        icon: UserPlus,
        detail: "in api",
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
        id: "needs-you",
        label: "Needs you",
        icon: Inbox,
        run: () => log.push("needs-you"),
      },
      {
        id: "workspace",
        label: "New workspace",
        icon: DoorOpen,
        disabled: true,
        detail: "No host is ready",
        run: () => log.push("workspace"),
      },
    ];
    const $ = (selector: string) =>
      host.querySelector<HTMLButtonElement>(selector);
    const items = () => [
      ...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ];
    const key = (target: Element, name: string) =>
      act(async () => {
        target.dispatchEvent(
          new KeyboardEvent("keydown", { key: name, bubbles: true }),
        );
      });
    return {
      log,
      $,
      items,
      key,
      more: () => $('[data-action="more"]')!,
      render: () =>
        act(async () => root.render(createElement(BoardHubDock, { actions }))),
      click: (button: HTMLElement) => act(async () => button.click()),
      async close() {
        await act(async () => root.unmount());
        host.remove();
      },
    };
  }

  test("+ launches and the crown opens the Town master, each one press", async () => {
    const hub = mount();
    await hub.render();
    const group = hub.$('[role="group"]')!;
    expect(group.getAttribute("aria-label")).toBe("Town center");
    const plus = hub.$('[data-action="launch"]')!;
    expect(plus.getAttribute("aria-label")).toBe("New agent, in api");
    expect(plus.hasAttribute("data-primary")).toBe(true);
    const crown = hub.$('[data-action="master"]')!;
    expect(crown.getAttribute("aria-label")).toBe("Town master, firstmate");
    await hub.click(plus);
    await hub.click(crown);
    expect(hub.log).toEqual(["launch", "master"]);
    expect(hub.items()).toEqual([]);
    await hub.close();
  });

  test("⋯ opens a menu of every action, focused on the first", async () => {
    const hub = mount();
    await hub.render();
    expect(hub.more().getAttribute("aria-haspopup")).toBe("menu");
    await hub.click(hub.more());
    expect(hub.more().getAttribute("aria-expanded")).toBe("true");
    expect(hub.items().map((item) => item.dataset.action)).toEqual([
      "launch",
      "master",
      "needs-you",
      "workspace",
    ]);
    expect(document.activeElement).toBe(hub.items()[0]!);
    expect(hub.items()[3]!.getAttribute("aria-disabled")).toBe("true");
    expect(hub.items()[3]!.getAttribute("aria-label")).toBe(
      "New workspace, No host is ready",
    );
    await hub.close();
  });

  test("arrow keys move through the menu, wrapping at its ends", async () => {
    const hub = mount();
    await hub.render();
    await hub.click(hub.more());
    const [first, second, , last] = hub.items();
    await hub.key(first!, "ArrowDown");
    expect(document.activeElement).toBe(second!);
    await hub.key(second!, "End");
    expect(document.activeElement).toBe(last!);
    await hub.key(last!, "ArrowDown");
    expect(document.activeElement).toBe(first!);
    await hub.key(first!, "ArrowUp");
    expect(document.activeElement).toBe(last!);
    await hub.close();
  });

  test("choosing closes the menu and runs; a disabled action does nothing", async () => {
    const hub = mount();
    await hub.render();
    await hub.click(hub.more());
    await hub.click(hub.items()[3]!);
    expect(hub.log).toEqual([]);
    expect(hub.items().length).toBe(4);
    await hub.click(hub.items()[2]!);
    expect(hub.log).toEqual(["needs-you"]);
    expect(hub.items()).toEqual([]);
    await hub.close();
  });

  test("Escape, a press outside and ⋯ again close it", async () => {
    const hub = mount();
    await hub.render();
    await hub.click(hub.more());
    await hub.key(hub.items()[0]!, "Escape");
    expect(hub.items()).toEqual([]);
    expect(document.activeElement).toBe(hub.more());

    await hub.click(hub.more());
    await act(async () => {
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
    });
    expect(hub.items()).toEqual([]);

    await hub.click(hub.more());
    await hub.click(hub.more());
    expect(hub.items()).toEqual([]);
    expect(hub.log).toEqual([]);
    await hub.close();
  });
}
