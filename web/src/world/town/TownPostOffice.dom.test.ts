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
    NodeFilter: browser.NodeFilter,
    PointerEvent: browser.PointerEvent ?? browser.MouseEvent,
    MouseEvent: browser.MouseEvent,
    FocusEvent: browser.FocusEvent,
    ResizeObserver: browser.ResizeObserver,
    getComputedStyle: browser.getComputedStyle.bind(browser),
    requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
    cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  // The shared asks, reviewed-work and Outbox stores never reach a service here.
  globalThis.fetch = (() => new Promise<Response>(() => {})) as never;
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { layoutTown, TOWN_SHAPES } = await import("./townLayout");
  const { TownPostOffice, TownPostProvider } = await import("./TownPostOffice");
  const { AnswerOutboxContext } = await import("./answerOutbox");
  const { WorldAsksStore } = await import("../worldAsks");
  const { WorldAnswerDeliveriesStore } = await import(
    "../worldAnswerDeliveries"
  );
  const { needsYouState, resetNeedsYouForTest } = await import("../needsYou");
  const { TOWN_POST_SLOTS } = await import("./townPostModel");
  type Source = import("./TownPostOffice").TownPostSource;
  type Leaf = import("../worldObject").WorldLeafObject;
  type WorldAsk = import("../worldAsks").WorldAsk;

  const town = (narrow: boolean) =>
    layoutTown(
      {
        hosts: [{ key: "a", displayOrder: 0 }],
        rooms: [{ key: "a/0", hostKey: "a", order: 0, deskKeys: ["a/0/0"] }],
      },
      narrow ? TOWN_SHAPES.phone : TOWN_SHAPES.wide,
    ).layout;

  async function mountSign(source: Source | null, narrow = false) {
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
    const office = await mountSign({
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
    const office = await mountSign({
      counts: { asks: 0, needs: 0, done: 0, outbox: 0 },
    });
    expect(office.counts()).toEqual([["none", "Nothing for you"]]);
    expect(office.sign.hasAttribute("data-waiting")).toBe(false);
    expect(office.sign.getAttribute("aria-label")).toBe(
      "Post office: nothing for you. Open Needs you",
    );
    await office.close();
  });

  test("a narrow town stands the same sign, in words, not a fold (#1351)", async () => {
    resetNeedsYouForTest();
    const office = await mountSign(
      { counts: { asks: 0, needs: 2, done: 1, outbox: 0 } },
      true,
    );
    expect(office.sign.className).toBe("town-post-sign");
    expect(office.sign.hasAttribute("data-narrow")).toBe(true);
    expect(office.sign.textContent).toContain("POST OFFICE");
    expect(office.counts()).toEqual([
      ["needs", "!2 blocked"],
      ["done", "✓1 to review"],
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
    const office = await mountSign({
      world: { leaves, nodeById: new Map(leaves.map((l) => [l.id, l])) },
    });
    expect(office.counts()).toEqual([["needs", "!2 blocked"]]);
    await office.close();
  });

  test("drawn alone, it is a sign without counts", async () => {
    const office = await mountSign(null);
    expect(office.counts()).toEqual([]);
    expect(office.sign.getAttribute("aria-label")).toBe(
      "Post office: Needs you. Open Needs you",
    );
    await office.close();
  });

  const ask = (index: number, verified = true): WorldAsk => ({
    id: `q-${index}`,
    at: Date.now() - (100 - index) * 60_000,
    actor: verified
      ? { label: `agent-${index}`, verified, name: `agent-${index}` }
      : { label: "unknown", verified, pane_id: `p-${index}` },
    question: `Deploy build ${index} now?`,
    options: ["Deploy", "Wait"],
    owner_only: false,
  });

  /** The World ledger, as the service would answer: open asks and counts. */
  function stores(asks: WorldAsk[], waiting = 0, checks = 0) {
    const client = {
      call: async (method: string) =>
        method === "world.asks.get"
          ? { revision: 1, asks }
          : {
              revision: 1,
              incarnation: "test",
              counts: { waiting, checks, connections: {} },
              deliveries: [],
              next: null,
            },
      onControl: () => () => {},
      onStatus: () => () => {},
    };
    return {
      asksStore: new WorldAsksStore(client),
      deliveries: new WorldAnswerDeliveriesStore(client),
    };
  }

  async function mount(
    narrow: boolean,
    data: ReturnType<typeof stores>,
    outbox: () => void = () => {},
  ) {
    resetNeedsYouForTest();
    const host = document.createElement("div");
    host.className = "town-world";
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        createElement(
          AnswerOutboxContext.Provider,
          { value: outbox },
          createElement(TownPostOffice, {
            layout: town(narrow),
            renderer: { current: null },
            ...data,
          }),
        ),
      ),
    );
    // The stores answer on the next turn.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return {
      host,
      letters: () => [
        ...host.querySelectorAll<HTMLButtonElement>(
          "button.town-post-envelope",
        ),
      ],
      trolley: () =>
        host.querySelector<HTMLButtonElement>(".town-post-trolley"),
      async close() {
        await act(async () => root.unmount());
        host.remove();
        for (const node of document.body.querySelectorAll(
          ".town-badge-popover, [data-radix-popper-content-wrapper]",
        ))
          node.remove();
      },
    };
  }

  const click = (element: Element | null | undefined) =>
    act(async () => {
      (element as HTMLElement).click();
    });

  test("each question is a letter; its card shows the question and answers in Needs you", async () => {
    const view = await mount(false, stores([ask(1), ask(2, false)]));
    try {
      const letters = view.letters();
      expect(
        letters.map((letter) => letter.getAttribute("aria-label")),
      ).toEqual([
        "Letter from agent-1: Deploy build 1 now?. Open letter",
        "Letter from p-2 (unverified): Deploy build 2 now?. Open letter",
      ]);
      expect(letters[1]?.hasAttribute("data-unverified")).toBe(true);
      await click(letters[0]);
      const card = document.querySelector<HTMLElement>(
        '.town-badge-popover[aria-label="Letter from agent-1"]',
      );
      expect(card?.querySelector(".town-post-card-question")?.textContent).toBe(
        "Deploy build 1 now?",
      );
      expect(
        [...(card?.querySelectorAll(".town-post-card-options li") ?? [])].map(
          (option) => option.textContent,
        ),
      ).toEqual(["Deploy", "Wait"]);
      const answer = [...(card?.querySelectorAll("button") ?? [])].find(
        (button) => button.textContent === "Answer in Needs you",
      );
      await click(answer);
      expect(needsYouState().request.itemKey).toBe("ask:q-1");
      expect(document.querySelector(".town-badge-popover")).toBeNull();
    } finally {
      await view.close();
    }
  });

  test("the trolley carries answers on their way and opens the Outbox", async () => {
    let opened = 0;
    const view = await mount(false, stores([], 1, 1), () => (opened += 1));
    try {
      expect(view.letters()).toHaveLength(0);
      expect(view.trolley()?.textContent).toBe("2");
      expect(view.trolley()?.hasAttribute("data-check")).toBe(true);
      expect(view.trolley()?.getAttribute("aria-label")).toBe(
        "Mail trolley: 1 answer to send, 1 answer to check. Open Outbox",
      );
      await click(view.trolley());
      expect(opened).toBe(1);
    } finally {
      await view.close();
    }
  });

  test("with no mail the yard is empty", async () => {
    const view = await mount(false, stores([]));
    try {
      expect(view.letters()).toHaveLength(0);
      expect(view.trolley()).toBeNull();
    } finally {
      await view.close();
    }
  });

  test("more letters than the yard holds make a bundle that lists the rest", async () => {
    const count = TOWN_POST_SLOTS + 4;
    const view = await mount(
      false,
      stores(Array.from({ length: count }, (_, index) => ask(index))),
    );
    try {
      expect(view.letters()).toHaveLength(TOWN_POST_SLOTS - 1);
      const bundle = view.host.querySelector(".town-post-bundle");
      expect(bundle?.textContent).toBe("+5");
      await click(bundle);
      const rows = [
        ...document.querySelectorAll<HTMLButtonElement>(".town-post-row"),
      ];
      expect(rows).toHaveLength(5);
      await click(rows[0]);
      expect(
        document.querySelector(
          `.town-badge-popover[aria-label="Letter from agent-${TOWN_POST_SLOTS - 1}"]`,
        ),
      ).not.toBeNull();
    } finally {
      await view.close();
    }
  });

  test("a narrow town has the same yard under its sign", async () => {
    let opened = 0;
    const view = await mount(true, stores([ask(1)], 1, 0), () => (opened += 1));
    try {
      expect(view.host.querySelector(".town-post-sign")).not.toBeNull();
      expect(view.letters()).toHaveLength(1);
      await click(view.trolley());
      expect(opened).toBe(1);
      await click(view.letters()[0]);
      expect(
        document.querySelector(
          '.town-badge-popover[aria-label="Letter from agent-1"]',
        ),
      ).not.toBeNull();
    } finally {
      await view.close();
    }
  });
}
