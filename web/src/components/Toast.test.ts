import { expect, test } from "bun:test";

if (process.env.HERDR_WORLD_TOAST_DOM_TEST !== "1") {
  test("mobile toast gestures in an isolated DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, HERDR_WORLD_TOAST_DOM_TEST: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(out + err);
    expect(code).toBe(0);
  });
} else {
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { Toast } = await import("./Toast");
  const { updateLayoutPreferences } = await import("../layoutPreferences");
  test("replacement, protected installation notices, cancellation and output scrolling", async () => {
    updateLayoutPreferences({ mode: "mobile" });
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    const timers = new Map<number, () => void>();
    let sequence = 0;
    const originalSet = window.setTimeout;
    const originalClear = window.clearTimeout;
    // Drive only Toast's 180ms exit deadline; no wall-clock race in this test.
    window.setTimeout = ((callback: () => void, delay?: number) => {
      if (delay !== 180) return originalSet.call(window, callback, delay);
      const id = ++sequence;
      timers.set(id, callback);
      return id;
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id: number) => {
      if (!timers.delete(id)) originalClear.call(window, id);
    }) as typeof window.clearTimeout;
    const dismissed: number[] = [];
    let key = 1;
    const render = async (disabled = false) =>
      act(async () =>
        root.render(
          createElement(Toast, {
            className: "toast",
            role: "status",
            notificationKey: key,
            dismissDisabled: disabled,
            onDismiss: () => {
              dismissed.push(key);
            },
            children: createElement(
              "div",
              { className: "toast-output" },
              createElement("pre", null, "output"),
            ),
          }),
        ),
      );
    const toast = () => host.querySelector<HTMLElement>(".toast")!;
    const pointer = async (
      type: string,
      y: number,
      target = toast(),
      pointerType = "touch",
    ) =>
      act(async () => {
        const event = new Event(type, { bubbles: true });
        Object.defineProperties(event, {
          pointerType: { value: pointerType },
          pointerId: { value: 1 },
          clientX: { value: 20 },
          clientY: { value: y },
        });
        target.dispatchEvent(event);
      });
    const swipe = async (end = "pointerup") => {
      await pointer("pointerdown", 100);
      await pointer("pointermove", 30);
      await pointer(end, 30);
    };
    const expire = async () =>
      act(async () => {
        const pending = [...timers.values()];
        timers.clear();
        for (const callback of pending) callback();
      });
    try {
      await render();
      // happy-dom does not implement Web Animations.
      toast().getAnimations = () => [];
      await swipe();
      expect(timers.size).toBe(1);
      key = 2;
      await render();
      await expire();
      expect(dismissed).toEqual([]);
      expect(toast().style.transform).toBe("");
      await pointer("pointerdown", 100);
      await pointer("pointermove", 30);
      key = 3;
      await render();
      await pointer("pointerup", 30);
      await expire();
      expect(dismissed).toEqual([]);
      expect(toast().style.opacity).toBe("");
      await swipe("pointercancel");
      await expire();
      expect(dismissed).toEqual([]);
      expect(toast().classList.contains("toast-swiping")).toBe(false);
      expect(toast().style.transform).toBe("");
      await render(true);
      await swipe();
      await expire();
      expect(dismissed).toEqual([]);
      expect(toast().style.transform).toBe("");
      await render();
      const output = host.querySelector("pre")!;
      output.scrollTop = 100;
      await pointer("pointerdown", 100, output);
      await pointer("pointermove", 30, output);
      await pointer("pointerup", 30, output);
      await expire();
      expect(output.scrollTop).toBe(170);
      expect(dismissed).toEqual([]);
      expect(toast().style.transform).toBe("");
      await pointer("pointerdown", 100, toast(), "mouse");
      await pointer("pointermove", 30, toast(), "mouse");
      await pointer("pointerup", 30, toast(), "mouse");
      await expire();
      expect(dismissed).toEqual([]);
      await swipe();
      await expire();
      expect(dismissed).toEqual([3]);
      expect(toast().style.opacity).toBe("");
    } finally {
      await act(async () => root.unmount());
      host.remove();
      window.setTimeout = originalSet;
      window.clearTimeout = originalClear;
    }
  });
}
