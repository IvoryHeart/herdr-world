import { expect, test } from "bun:test";

if (process.env.NEEDS_YOU_HOST_DOM !== "1") {
  test("Needs you's frames in an isolated React DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, NEEDS_YOU_HOST_DOM: "1" },
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
  }, 30000);
} else {
  const browser = globalThis.window as unknown as typeof globalThis;
  for (const [key, value] of Object.entries({
    HTMLButtonElement: browser.HTMLButtonElement,
    HTMLInputElement: browser.HTMLInputElement,
    NodeFilter: browser.NodeFilter,
    MouseEvent: browser.MouseEvent,
    KeyboardEvent: browser.KeyboardEvent,
    CustomEvent: browser.CustomEvent,
    PointerEvent: browser.PointerEvent ?? browser.MouseEvent,
    ResizeObserver: browser.ResizeObserver,
    MutationObserver: browser.MutationObserver,
    IntersectionObserver: browser.IntersectionObserver,
    DOMParser: browser.DOMParser,
    CSS: browser.CSS,
    location: browser.location,
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
  const { act, createElement: h } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { bridge } = await import("../api");
  // One synthetic question; nothing reaches World or Herdr.
  const asks = {
    revision: 1,
    asks: [
      {
        id: "q-draft1",
        at: Date.now() - 60_000,
        actor: { label: "claude in w1:p2", name: "Atlas", verified: true },
        question: "Which synthetic fixture should the run use?",
        options: [],
        owner_only: true,
      },
    ],
  };
  Object.assign(bridge, {
    call: async (method: string) =>
      method === "world.asks.get" ? structuredClone(asks) : {},
    onControl: () => () => {},
    onStatus: () => () => {},
  });
  const { NeedsYouHost } = await import("./NeedsYouTab");
  const { closeNeedsYou, openNeedsYou } = await import("./needsYou");
  type World = Parameters<typeof NeedsYouHost>[0]["world"];

  test("the post office's window over the open tab keeps an unsent answer", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    await act(async () => {
      root.render(
        h(NeedsYouHost, {
          world: { leaves: [], nodes: [] } as unknown as World,
          onChat: () => {},
          onOpenTerminal: () => {},
        }),
      );
    });
    await act(async () => openNeedsYou());
    await act(async () => {});
    const field = () =>
      document.querySelector<HTMLInputElement>(
        'input[aria-label^="Your answer to"]',
      );
    expect(document.querySelector(".needs-you-tab")).not.toBeNull();
    const typed = field()!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        browser.HTMLInputElement.prototype,
        "value",
      )!.set!.call(typed, "An unsent answer");
      typed.dispatchEvent(new browser.Event("input", { bubbles: true }));
    });
    expect(field()!.value).toBe("An unsent answer");

    // The post office opens the same list in Town's one window.
    await act(async () => openNeedsYou(undefined, { window: true }));
    const frame = document.querySelector<HTMLElement>(
      '.modal.place-window[data-place-window="needs-you"]',
    );
    expect(frame).not.toBeNull();
    expect(document.querySelector(".needs-you-tab")).toBeNull();
    expect(frame!.contains(field())).toBe(true);
    expect(field()).toBe(typed);
    expect(field()!.value).toBe("An unsent answer");

    // Closing it returns to the tab, the answer still there.
    await act(async () => closeNeedsYou());
    expect(document.querySelector(".place-window")).toBeNull();
    const tab = document.querySelector(".needs-you-tab");
    expect(tab?.contains(field())).toBe(true);
    expect(field()!.value).toBe("An unsent answer");

    await act(async () => closeNeedsYou());
    expect(field()).toBeNull();
    await act(async () => root.unmount());
  });
}
