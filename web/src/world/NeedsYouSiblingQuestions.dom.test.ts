import { expect, test } from "bun:test";

if (process.env.SIBLING_QUESTIONS_DOM !== "1") {
  test("questions from other Worlds in an isolated React DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, SIBLING_QUESTIONS_DOM: "1" },
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
    PointerEvent: browser.PointerEvent ?? browser.MouseEvent,
    ResizeObserver: browser.ResizeObserver,
    MutationObserver: browser.MutationObserver,
    DOMParser: browser.DOMParser,
    location: browser.location,
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
  const { default: SiblingQuestionsFixture } = await import(
    "../testing/SiblingQuestionsFixture"
  );

  test("another World's question is answerable here; an alert alone links to its World", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    await act(async () => {
      root.render(h(SiblingQuestionsFixture));
    });
    const items = () => [
      ...host.querySelectorAll<HTMLElement>("[data-needs-you-item]"),
    ];
    const item = (id: string) =>
      items().find((entry) => entry.dataset.needsYouItem === `ask:${id}`)!;
    await act(async () => {});
    expect(items()).toHaveLength(4);

    // This World's own question: no home line.
    expect(item("q-local1").querySelector(".needs-you-home")).toBeNull();

    // Another World's question: says where it lives, answers here.
    const remote = item("peer~0123456789abcdef01234567~q-home1");
    const home = remote.querySelector(".needs-you-home")!;
    expect(home.textContent).toBe(
      "Asked in Herdr World · release. Your answer closes it there.",
    );
    expect(home.querySelector("a")!.getAttribute("href")).toBe(
      "http://127.0.0.1:19100/",
    );
    // No paperclip: files stay on the World they were attached in.
    expect(remote.querySelector(".needs-you-attach")).toBeNull();
    await act(async () => {
      remote
        .querySelector<HTMLButtonElement>(".needs-you-replies button")!
        .click();
    });
    expect(items()).toHaveLength(3);

    // An alert alone: the question, where to answer it, no answer field.
    const linked = item("alert~q-alert1");
    expect(linked.querySelector(".needs-you-home")!.textContent).toBe(
      "Asked in Herdr World · release. Open it to answer.",
    );
    expect(linked.querySelector("form, .needs-you-replies")).toBeNull();
    expect(linked.querySelector(".needs-you-tag")).toBeNull();
    const unknown = item("alert~q-alert2");
    expect(unknown.querySelector(".needs-you-home")!.textContent).toBe(
      "Asked in another World. This World cannot read it; answer it there.",
    );
    expect(unknown.querySelector(".needs-you-home a")).toBeNull();
    // ✕ hides the alert.
    await act(async () => {
      linked
        .querySelector<HTMLButtonElement>('button[title="Hide alert"]')!
        .click();
    });
    expect(items().map((entry) => entry.dataset.needsYouItem)).toEqual([
      "ask:q-local1",
      "ask:alert~q-alert2",
    ]);
    await act(async () => root.unmount());
  });
}
