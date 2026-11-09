import { expect, mock, test } from "bun:test";

if (process.env.WINDOW_CONTROLS_DOM !== "1") {
  test("window menu fit choices run in an isolated DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, WINDOW_CONTROLS_DOM: "1" },
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
  for (const key of ["HTMLButtonElement", "MutationObserver", "CustomEvent"])
    Object.defineProperty(globalThis, key, {
      value: (window as unknown as Record<string, unknown>)[key],
      configurable: true,
    });
  Object.defineProperty(globalThis, "getComputedStyle", {
    value: window.getComputedStyle.bind(window),
    configurable: true,
  });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { WindowControls } = await import("./WindowControls");

  const renderMenu = async (compact: boolean) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onFit = mock(() => {});
    const onSnap = mock(() => {});
    await act(async () =>
      root.render(
        createElement(WindowControls, {
          label: "Agent window",
          controls: {
            compact,
            maximized: false,
            onMinimize() {},
            onMaximize() {},
            onClose() {},
            onFloat() {},
            onSnap,
            onFit,
          },
        }),
      ),
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click(),
    );
    const items = () =>
      Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          '[aria-label="Window actions"] [role^="menuitem"]',
        ),
      );
    return {
      items,
      labels: () => items().map((item) => item.textContent?.trim()),
      onFit,
      onSnap,
      async unmount() {
        await act(async () => root.unmount());
        host.remove();
      },
    };
  };

  test("⋯ offers Fit right and Fit left above the half and quarter snaps", async () => {
    const menu = await renderMenu(false);
    try {
      const labels = menu.labels();
      expect(labels.slice(0, 4)).toEqual([
        "Minimize",
        "Fit right",
        "Fit left",
        "Left half",
      ]);
      expect(labels).toContain("Right half");
      await act(async () =>
        menu
          .items()
          .find((item) => item.textContent?.trim() === "Fit right")!
          .click(),
      );
      expect(menu.onFit).toHaveBeenLastCalledWith("right");
      expect(menu.onSnap).not.toHaveBeenCalled();
    } finally {
      await menu.unmount();
    }
    const again = await renderMenu(false);
    try {
      await act(async () =>
        again
          .items()
          .find((item) => item.textContent?.trim() === "Fit left")!
          .click(),
      );
      expect(again.onFit).toHaveBeenLastCalledWith("left");
    } finally {
      await again.unmount();
    }
  });

  test("a phone layout, where windows fill the screen, has no fit choices", async () => {
    const menu = await renderMenu(true);
    try {
      expect(menu.labels()).not.toContain("Fit right");
      expect(menu.labels()).not.toContain("Fit left");
    } finally {
      await menu.unmount();
    }
  });
}
