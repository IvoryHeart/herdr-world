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
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { layoutTown, TOWN_SHAPES } = await import("./townLayout");
  const { TownPostOffice } = await import("./TownPostOffice");
  const { AnswerOutboxContext } = await import("./answerOutbox");
  const { WorldAsksStore } = await import("../worldAsks");
  const { WorldAnswerDeliveriesStore } = await import(
    "../worldAnswerDeliveries"
  );
  const { needsYouState, resetNeedsYouForTest } = await import("../needsYou");
  const { TOWN_POST_SLOTS } = await import("./townPostModel");
  type WorldAsk = import("../worldAsks").WorldAsk;

  const town = (narrow: boolean) =>
    layoutTown(
      {
        hosts: [{ key: "a", displayOrder: 0 }],
        rooms: [{ key: "a/0", hostKey: "a", order: 0, deskKeys: ["a/0/0"] }],
      },
      narrow ? TOWN_SHAPES.phone : TOWN_SHAPES.wide,
    ).layout;

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
      sign: () => host.querySelector<HTMLButtonElement>(".town-post-sign"),
      letters: () => [
        ...host.querySelectorAll<HTMLButtonElement>("button.town-post-letter"),
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

  test("the sign counts letters in and answers out, and opens Needs you at the oldest", async () => {
    const view = await mount(false, stores([ask(2), ask(1)], 2, 1));
    try {
      expect(view.sign()?.textContent).toBe(
        "POST OFFICE2 letters2 to send1 to check",
      );
      expect(view.sign()?.getAttribute("aria-label")).toBe(
        "Post office: 2 questions for you, 2 answers to send, 1 answer to check. Open Needs you",
      );
      expect(view.sign()?.hasAttribute("data-quiet")).toBe(false);
      await click(view.sign());
      expect(needsYouState().open).toBe(true);
      expect(needsYouState().request.itemKey).toBe("ask:q-1");
    } finally {
      await view.close();
    }
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

  test("with no mail the sign is quiet and the yard empty", async () => {
    const view = await mount(false, stores([]));
    try {
      expect(view.sign()?.textContent).toBe("POST OFFICENo mail");
      expect(view.sign()?.hasAttribute("data-quiet")).toBe(true);
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

  test("a narrow town has the same post office, its sign a narrow plate", async () => {
    let opened = 0;
    const view = await mount(true, stores([ask(1)], 1, 0), () => (opened += 1));
    try {
      expect(view.sign()?.hasAttribute("data-narrow")).toBe(true);
      expect(view.sign()?.textContent).toBe("POST OFFICE1 letter1 to send");
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
