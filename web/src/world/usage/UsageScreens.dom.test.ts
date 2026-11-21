import { expect, test } from "bun:test";

if (process.env.USAGE_SCREENS_DOM !== "1") {
  test("the observatory, Usage and the agent card line in an isolated React DOM", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, USAGE_SCREENS_DOM: "1" },
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
    location: browser.location,
    history: browser.history,
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
  const { bridge } = await import("../../api");
  const { layoutTown, TOWN_SHAPES } = await import("../town/townLayout");
  const { TownObservatory } = await import("../town/TownObservatory");
  const { TownOpenUsageContext, useTownUsage } = await import(
    "../town/TownUsageLens"
  );
  const { useUsageOpener } = await import("./usageOpener");
  const { UsageLens } = await import("./UsageLens");
  const { AgentUsageLine } = await import("./AgentUsageLine");
  const { resetUsageFixture, usageFixture } = await import("./usageFixture");
  const { resetUsageStores } = await import("./usageStore");
  const { usageRuns } = await import("./usageModel");

  // The service is never reached: a call that is not the fixture's fails.
  const calls: string[] = [];
  bridge.call = (async (method: string) => {
    calls.push(method);
    throw new Error("no service in this test");
  }) as typeof bridge.call;

  /** Turns the testing switch on as a page load with `?usageFixture=`. */
  function fixture(mode: "busy" | "reached" | "empty" | null) {
    history.replaceState(
      null,
      "",
      mode === null ? "/" : `/?usageFixture=${mode}`,
    );
    resetUsageFixture();
    resetUsageStores();
  }

  async function mount(element: ReturnType<typeof createElement>) {
    const host = document.createElement("div");
    host.className = "town-world";
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(element));
    // The fixture answers on the next microtask.
    await act(async () => {
      await Promise.resolve();
    });
    return {
      host,
      async close() {
        await act(async () => root.unmount());
        host.remove();
      },
    };
  }

  const town = (narrow: boolean) =>
    layoutTown(
      {
        hosts: [{ key: "a", displayOrder: 0 }],
        rooms: [{ key: "a/0", hostKey: "a", order: 0, deskKeys: ["a/0/0"] }],
      },
      narrow ? TOWN_SHAPES.phone : TOWN_SHAPES.wide,
    ).layout;

  const observatory = (narrow: boolean, open: (tab?: string) => void) =>
    createElement(
      TownOpenUsageContext.Provider,
      { value: open },
      createElement(TownObservatory, {
        layout: town(narrow),
        agents: new Map(),
      }),
    );

  test("the switch is read once and its parameter leaves the address at once", async () => {
    fixture("busy");
    const view = await mount(observatory(false, () => {}));
    expect(location.search).toBe("");
    expect(calls).toEqual([]);
    await view.close();
  });

  test("the observatory sign shows both harnesses' windows, lights a window per agent at work and opens Usage", async () => {
    fixture("busy");
    const opened: (string | undefined)[] = [];
    const view = await mount(observatory(false, (tab) => opened.push(tab)));
    const sign = view.host.querySelector<HTMLButtonElement>(
      ".town-observatory-sign",
    )!;
    expect(sign.textContent).toContain("OBSERVATORY");
    expect(sign.textContent).toContain("Claude2");
    expect(sign.textContent).toContain("40% · ");
    expect(sign.textContent).toContain("71% · ");
    expect(sign.getAttribute("aria-label")).toStartWith(
      "Observatory: Claude, 2 at work: 5 h 40% used",
    );
    expect(sign.getAttribute("aria-label")).toEndWith(". Open Usage");
    expect(
      [
        ...view.host.querySelectorAll<HTMLElement>(".town-observatory-light"),
      ].map((light) => light.dataset.harness),
    ).toEqual(["claude", "claude", "codex", "cursor"]);
    await act(async () => sign.click());
    expect(opened).toEqual(["budget"]);
    await view.close();
  });

  test("a narrow town shows the folded sign with each harness's fuller window", async () => {
    fixture("busy");
    const opened: (string | undefined)[] = [];
    const view = await mount(observatory(true, (tab) => opened.push(tab)));
    expect(view.host.querySelector(".town-observatory-sign")).toBeNull();
    const fold = view.host.querySelector<HTMLButtonElement>(
      ".town-observatory-fold",
    )!;
    // Cursor keeps no budget World reads: its dial says so, never zero.
    expect(fold.textContent).toBe("Claude 71%Codex 18%Cursor ?");
    await act(async () => fold.click());
    expect(opened).toEqual(["budget"]);
    await view.close();
  });

  test("a reached limit reads as a limit; nothing observed reads as no reading, never zero", async () => {
    fixture("reached");
    let view = await mount(observatory(true, () => {}));
    expect(view.host.querySelector(".town-observatory-fold")!.textContent).toBe(
      "Claude limitCodex 18%Cursor ?",
    );
    await view.close();
    fixture("empty");
    view = await mount(observatory(false, () => {}));
    const sign = view.host.querySelector(".town-observatory-sign")!;
    expect(sign.textContent).toContain("No budget reading yet");
    expect(sign.textContent).not.toMatch(/\d/);
    await view.close();
  });

  test("a failed read says usage is unavailable", async () => {
    fixture(null);
    const view = await mount(observatory(false, () => {}));
    expect(
      view.host.querySelector(".town-observatory-sign")!.textContent,
    ).toContain("Usage unavailable");
    expect(calls).toContain("world.usage.analytics");
    await view.close();
  });

  test("Usage answers budget pace, runs at once by hour and tokens by role, item and run", async () => {
    fixture("busy");
    let closed = 0;
    const view = await mount(
      createElement(UsageLens, { onClose: () => (closed += 1) }),
    );
    const lens = view.host.querySelector<HTMLElement>(".usage-lens")!;
    const tab = (name: string) =>
      [...lens.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (button) => button.textContent === name,
      )!;
    expect(tab("Budget").getAttribute("aria-selected")).toBe("true");
    expect(
      [...lens.querySelectorAll(".usage-card")].map((card) =>
        card.getAttribute("aria-label"),
      ),
    ).toEqual(["Claude budget", "Codex budget"]);
    expect(lens.querySelectorAll(".usage-pace").length).toBe(4);

    await act(async () => tab("Runs at once").click());
    expect(lens.dataset.tab).toBe("runs");
    // One chart per harness this week, Cursor and OpenCode from World's time.
    expect(lens.querySelectorAll(".usage-chart").length).toBe(4);
    const toggle = [...lens.querySelectorAll("button")].find(
      (button) => button.textContent === "Show as table",
    )!;
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(lens.querySelector(".usage-table")).not.toBeNull();

    await act(async () => tab("Tokens").click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(lens.textContent).toContain("Running now");
    expect(lens.textContent).toContain("Heaviest this week");
    expect(lens.querySelector('[aria-label="Tokens by role"]')).not.toBeNull();
    expect(lens.textContent).toContain("By item#101");
    // A fixer going in circles stands out.
    expect(lens.querySelector(".usage-flag")).not.toBeNull();
    // A harness World reads no log of: its time, and plainly no tokens.
    expect(lens.textContent).toContain(
      "tokens and cost not available for this harness",
    );

    await act(async () => tab("Breakdown").click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(lens.dataset.tab).toBe("breakdown");
    const heads = () =>
      [...lens.querySelectorAll(".usage-breakdown-table thead th")].map(
        (th) => th.textContent,
      );
    expect(heads()).toEqual([
      "Agent",
      "At work",
      "Waiting on you",
      "Tokens",
      "Cost",
      "PRs opened / merged",
    ]);
    // Without World's agents to name them, earlier agents say so.
    expect(lens.textContent).toContain("Earlier agent");
    const cursorRow = [
      ...lens.querySelectorAll(".usage-breakdown-table tbody tr"),
    ].find((tr) => tr.textContent?.includes("25 min"))!;
    expect(cursorRow.textContent).toContain("unknown");
    expect(lens.textContent).toContain("est. $");
    expect(lens.textContent).toContain("Cursor tokens and cost not available");
    for (const [name, head] of [
      ["Room", "Room"],
      ["Day", "Day"],
      ["Project", "Project"],
    ]) {
      const button = [
        ...lens.querySelectorAll<HTMLButtonElement>(".usage-group button"),
      ].find((b) => b.textContent === name)!;
      await act(async () => button.click());
      await act(async () => {
        await Promise.resolve();
      });
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(heads()[0]).toBe(head);
    }
    expect(
      lens.querySelector(".usage-breakdown-table tfoot")!.textContent,
    ).toContain("This week");

    await act(async () =>
      lens
        .querySelector<HTMLButtonElement>('[aria-label="Close Usage"]')!
        .click(),
    );
    expect(closed).toBe(1);
    await view.close();
  });

  test("with nothing observed, Usage says there is no reading instead of zeros", async () => {
    fixture("empty");
    const view = await mount(
      createElement(UsageLens, { initialTab: "tokens", onClose: () => {} }),
    );
    const lens = view.host.querySelector(".usage-lens")!;
    expect(lens.textContent).toContain("No runs this week");
    expect(lens.textContent).not.toMatch(/\b0 tokens/);
    await view.close();
  });

  test("an agent's card line shows its run, or says unknown for a pane with no run", async () => {
    fixture("busy");
    const now = Date.now();
    const live = usageRuns(
      usageFixture(now, "busy", { group_by: "run", window: "7d" }),
    ).find((run) => run.identity?.pane_id && run.tokens !== null)!;
    const identity = live.identity!;
    let opened = 0;
    const view = await mount(
      createElement(AgentUsageLine, {
        pane: {
          connectionId: identity.connection_id!,
          generation: identity.connection_generation!,
          paneId: identity.pane_id!,
        },
        onOpen: () => (opened += 1),
      }),
    );
    const line =
      view.host.querySelector<HTMLButtonElement>("button.agent-usage")!;
    expect(line.textContent).toContain(" tokens · ");
    expect(line.textContent).toContain(`${live.calls} calls`);
    expect(line.getAttribute("aria-label")).toEndWith(". Open Usage");
    await act(async () => line.click());
    expect(opened).toBe(1);
    await view.close();

    const other = await mount(
      createElement(AgentUsageLine, {
        pane: {
          connectionId: "fixture",
          generation: 2,
          paneId: identity.pane_id!,
        },
      }),
    );
    expect(other.host.textContent).toBe("This run: usage unknown");
    await other.close();
  });

  test("Town's opener opens Breakdown on one agent, and clearing it shows every agent", async () => {
    fixture("busy");
    let open: ReturnType<typeof useUsageOpener> = null;
    function Town() {
      return useTownUsage().lens;
    }
    function Apartments() {
      open = useUsageOpener();
      return null;
    }
    const view = await mount(
      createElement(
        "div",
        null,
        createElement(Town),
        createElement(Apartments),
      ),
    );
    expect(open).not.toBeNull();
    await act(async () =>
      open!("breakdown", {
        ids: ["fixture-agent-0", "fixture-agent-2"],
        label: "linus",
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    const lens = () => view.host.querySelector<HTMLElement>(".usage-lens")!;
    const bodyRows = () =>
      [...lens().querySelectorAll(".usage-breakdown-table tbody th")].map(
        (cell) => cell.textContent,
      );
    expect(lens().dataset.tab).toBe("breakdown");
    expect(lens().querySelector(".usage-filter")!.textContent).toBe(
      "Agent: linus",
    );
    expect(lens().querySelector('[aria-label="Group by"]')).toBeNull();
    // Its two runs, named by the resident; the total is this agent's.
    expect(bodyRows()).toEqual(["linus", "linus"]);
    const total = lens().querySelector(".usage-breakdown-table tfoot tr")!;
    expect(total.querySelector("th")!.textContent).toBe("This agent");
    expect(total.textContent).toContain("5 h (partly read)");
    expect(total.textContent).toContain("14M (partly read)");
    // Clearing the filter shows every agent and the grouping again.
    await act(async () =>
      lens()
        .querySelector<HTMLButtonElement>('[aria-label="Show every agent"]')!
        .click(),
    );
    expect(lens().querySelector(".usage-filter")).toBeNull();
    expect(lens().querySelector('[aria-label="Group by"]')).not.toBeNull();
    expect(bodyRows()).toHaveLength(16);
    expect(
      lens().querySelector(".usage-breakdown-table tfoot th")!.textContent,
    ).toBe("This week");
    await view.close();
    // Town gone: no opener for windows outside it.
    const after = await mount(createElement(Apartments));
    expect(open).toBeNull();
    await after.close();
  });

  test("an agent with no run this week reads as nothing measured, not zeros", async () => {
    fixture("busy");
    const view = await mount(
      createElement(UsageLens, {
        initialTab: "breakdown",
        initialFilter: { ids: ["agent_gone"], label: "hopper" },
        onClose: () => {},
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    const lens = view.host.querySelector(".usage-lens")!;
    expect(lens.textContent).toContain("Nothing measured for hopper this week");
    expect(lens.querySelector(".usage-breakdown-table")).toBeNull();
    await view.close();
  });
}
