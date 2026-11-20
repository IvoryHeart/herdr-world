import { expect, test } from "bun:test";

if (process.env.TOWN_POST_DOM !== "1") {
  test("the post office in an isolated React DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, TOWN_POST_DOM: "1" },
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
    KeyboardEvent: browser.KeyboardEvent,
    CustomEvent: browser.CustomEvent,
    PointerEvent: browser.PointerEvent ?? browser.MouseEvent,
    MouseEvent: browser.MouseEvent,
    FocusEvent: browser.FocusEvent,
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  // The asks, reviewed-work and Outbox stores never reach a service here.
  globalThis.fetch = (() => new Promise<Response>(() => {})) as never;
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { layoutTown, TOWN_SHAPES } = await import("./townLayout");
  const { TownPostOffice, TownPostProvider } = await import("./TownPostOffice");
  const { needsYouState, resetNeedsYouForTest } = await import("../needsYou");
  type Source = import("./TownPostOffice").TownPostSource;
  type Leaf = import("../worldObject").WorldLeafObject;

  const town = (narrow: boolean) =>
    layoutTown(
      {
        hosts: [{ key: "a", displayOrder: 0 }],
        rooms: [{ key: "a/0", hostKey: "a", order: 0, deskKeys: ["a/0/0"] }],
      },
      narrow ? TOWN_SHAPES.phone : TOWN_SHAPES.wide,
    ).layout;

  async function mount(source: Source | null, narrow = false) {
    const host = document.createElement("div");
    host.className = "town-world";
    document.body.append(host);
    const root = createRoot(host);
    const office = createElement(TownPostOffice, {
      layout: town(narrow),
      renderer: { current: null },
    });
    await act(async () =>
      root.render(
        source
          ? createElement(TownPostProvider, { source, children: office })
          : office,
      ),
    );
    return {
      sign: host.querySelector<HTMLButtonElement>("button")!,
      counts: () =>
        [...host.querySelectorAll<HTMLElement>(".town-post-counts > span")].map(
          (span) => [span.dataset.kind, span.textContent],
        ),
      async close() {
        await act(async () => root.unmount());
        host.remove();
      },
    };
  }

  test("its sign counts what is addressed to you, by kind, and opens Needs you", async () => {
    resetNeedsYouForTest();
    const office = await mount({
      counts: { asks: 2, needs: 1, done: 3, outbox: 1 },
    });
    expect(office.sign.className).toBe("town-post-sign");
    expect(office.sign.hasAttribute("data-waiting")).toBe(true);
    expect(office.sign.textContent).toStartWith("POST OFFICE");
    // The shared agent marks, as Needs you and the desks show them.
    expect(office.counts()).toEqual([
      ["asks", "?2 questions"],
      ["needs", "!1 blocked"],
      ["done", "✓3 to review"],
      ["outbox", "✉1 to check"],
    ]);
    expect(office.sign.getAttribute("aria-label")).toBe(
      "Post office: 2 questions for you, 1 agent blocked, 3 finished to review, 1 answer to check. Open Needs you",
    );
    // No pull requests: those are the warehouse's.
    expect(office.sign.textContent).not.toMatch(/ready|failing|PR|pull/i);
    expect(needsYouState().open).toBe(false);
    await act(async () => office.sign.click());
    expect(needsYouState().open).toBe(true);
    await office.close();
  });

  test("with nothing for you, it says so and does not light up", async () => {
    const office = await mount({
      counts: { asks: 0, needs: 0, done: 0, outbox: 0 },
    });
    expect(office.counts()).toEqual([["none", "Nothing for you"]]);
    expect(office.sign.hasAttribute("data-waiting")).toBe(false);
    expect(office.sign.getAttribute("aria-label")).toBe(
      "Post office: nothing for you. Open Needs you",
    );
    await office.close();
  });

  test("a narrow town folds it to a sign of marks and numbers", async () => {
    resetNeedsYouForTest();
    const office = await mount(
      { counts: { asks: 0, needs: 2, done: 1, outbox: 0 } },
      true,
    );
    expect(office.sign.className).toBe("town-post-fold");
    expect(office.counts()).toEqual([
      ["needs", "!2"],
      ["done", "✓1"],
    ]);
    // Keyboard: a button, so Enter and Space open it as a click does.
    expect(office.sign.type).toBe("button");
    await act(async () => office.sign.click());
    expect(needsYouState().open).toBe(true);
    await office.close();
  });

  test("in Town it counts Needs you's own items in Town's world", async () => {
    const leaf = (id: string, status: Leaf["status"]) =>
      ({
        id,
        kind: "agent",
        nativeId: `w1:${id}`,
        connectionId: "local",
        generation: 1,
        label: `${id}-claude`,
        agentName: id,
        status,
        stale: false,
        actionable: true,
        lastActivityAt: 1,
        terminalId: `terminal-${id}`,
        pane: { pane_id: `w1:${id}` },
        stateLabels: {},
      }) as unknown as Leaf;
    const leaves = [
      leaf("one", "blocked"),
      leaf("two", "blocked"),
      leaf("three", "working"),
    ];
    const office = await mount({
      world: { leaves, nodeById: new Map(leaves.map((l) => [l.id, l])) },
    });
    expect(office.counts()).toEqual([["needs", "!2 blocked"]]);
    await office.close();
  });

  test("drawn alone, it is a sign without counts", async () => {
    const office = await mount(null);
    expect(office.counts()).toEqual([]);
    expect(office.sign.getAttribute("aria-label")).toBe(
      "Post office: Needs you. Open Needs you",
    );
    await office.close();
  });
}
