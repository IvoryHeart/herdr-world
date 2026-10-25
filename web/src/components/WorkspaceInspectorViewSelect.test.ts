import { expect, mock, test } from "bun:test";

if (process.env.INSPECTOR_VIEW_DOM !== "1") {
  test("mobile Inspector separates views from attention in an isolated DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, INSPECTOR_VIEW_DOM: "1" },
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
  });
} else {
  for (const key of [
    "HTMLButtonElement",
    "HTMLInputElement",
    "NodeFilter",
    "MutationObserver",
    "CustomEvent",
  ])
    Object.defineProperty(globalThis, key, {
      value: (window as unknown as Record<string, unknown>)[key],
      configurable: true,
    });
  Object.defineProperty(globalThis, "getComputedStyle", {
    value: window.getComputedStyle.bind(window),
    configurable: true,
  });
  const { act, createElement, createRef } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { WorkspaceInspectorViewSelect, WorkspaceInspectorSecondaryControls } =
    await import("./WorkspaceInspectorViewSelect");
  const { WindowControls } = await import("../world/windows/WindowControls");
  test("view dropdown preserves admission and attention menu preserves its owner callback", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const change = mock(() => {});
    const attention = mock(() => {});
    let pinned = false;
    const onPin = mock((next: boolean) => {
      pinned = next;
    });
    const views = [
      "terminal",
      "files",
      "history",
      "changes",
      "commits",
    ] as const;
    const render = async (historyAvailable: boolean) =>
      act(async () =>
        root.render(
          createElement(
            "div",
            {},
            createElement(WorkspaceInspectorViewSelect, {
              value: "terminal",
              availableViews: views,
              historyAvailable,
              onChange: change,
            }),
            createElement(WorkspaceInspectorSecondaryControls, {
              commitsAvailable: true,
              view: "history",
              commitsRef: createRef<HTMLButtonElement>(),
              onViewChange: change,
              onKeyDown() {},
            }),
            createElement(WindowControls, {
              label: "Inspector window",
              controls: {
                compact: true,
                maximized: true,
                onMinimize() {},
                onMaximize() {},
                onClose() {},
                onFloat() {},
                onSnap() {},
                attention: { current: "watching", onInterest: attention },
                pin: { pinned, onPin },
              },
            }),
          ),
        ),
      );
    try {
      await render(true);
      expect(host.querySelector("select")).toBeNull();
      const openViews = async () =>
        act(async () =>
          host
            .querySelector<HTMLButtonElement>(
              '[aria-label="Inspector view: Terminal"]',
            )!
            .click(),
        );
      await openViews();
      expect(
        Array.from(
          document.querySelectorAll('[aria-label="Inspector views"] button'),
        ).map((button) => button.textContent?.trim()),
      ).toEqual(["Chat", "Terminal", "Files", "Changes"]);
      for (let index = 0; index < 4; index++) {
        if (index > 0) await openViews();
        await act(async () =>
          document
            .querySelector<HTMLButtonElement>(
              `[aria-label="Inspector views"] [data-view="${views[index]}"]`,
            )!
            .click(),
        );
        expect(change).toHaveBeenLastCalledWith(views[index]);
      }
      expect(host.querySelector('[aria-label^="Interest:"]')).toBeNull();
      const menuButton = host.querySelector<HTMLButtonElement>(
        '[aria-haspopup="menu"]',
      )!;
      expect(menuButton).not.toBeNull();
      await act(async () => menuButton.click());
      const menu = document.querySelector('[aria-label="Window actions"]')!;
      expect(
        menu.querySelector('[role^="menuitem"]')?.textContent?.trim(),
      ).toBe("Pin desk in Town");
      const choices = Array.from(
        menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
      );
      expect(
        choices.map((button) => button.querySelector("span")?.textContent),
      ).toEqual(["Watching", "Muted", "Focused"]);
      expect(choices[0]!.getAttribute("aria-checked")).toBe("true");
      const calls = change.mock.calls.length;
      await act(async () => choices[1]!.click());
      expect(attention).toHaveBeenLastCalledWith("muted");
      expect(change.mock.calls.length).toBe(calls);
      expect(host.querySelector(".workspace-inspector-pin")).toBeNull();
      await act(async () => menuButton.click());
      const pinItem = document.querySelector<HTMLButtonElement>(
        '[aria-label="Window actions"] .world-window-pin',
      )!;
      await act(async () => pinItem.click());
      expect(onPin).toHaveBeenLastCalledWith(true);
      await render(false);
      await openViews();
      const unavailableChat = document.querySelector<HTMLButtonElement>(
        '[aria-label="Inspector views"] [data-view="history"]',
      )!;
      expect(unavailableChat.disabled).toBe(true);
      await act(async () => unavailableChat.click());
      expect(change.mock.calls.length).toBe(calls);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
}
