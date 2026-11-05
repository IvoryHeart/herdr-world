import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

// Needs you answers and review marks, clicked in a DOM. React and happy-dom
// globals stay in their own runtime, as ThemedSelect's test keeps them.
if (process.env.HERDR_WORLD_NEEDS_YOU_DOM_TEST !== "1") {
  test("Needs you answers and review marks in an isolated runtime", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, HERDR_WORLD_NEEDS_YOU_DOM_TEST: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  }, 30_000);
} else {
  await registerDomTest();
}

async function registerDomTest() {
  const browser = new Window({ url: "http://localhost" });
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLButtonElement",
    "Element",
    "Node",
    "NodeFilter",
    "DOMParser",
    "Event",
    "CustomEvent",
    "MutationObserver",
    "ResizeObserver",
    "KeyboardEvent",
    "MouseEvent",
    "FocusEvent",
    "localStorage",
    "history",
    "location",
  ] as const) {
    Object.defineProperty(globalThis, key, {
      value: key === "window" ? browser : browser[key],
      writable: true,
      configurable: true,
    });
  }
  Object.assign(globalThis, {
    getComputedStyle: browser.getComputedStyle.bind(browser),
    CSS: { escape: (value: string) => value },
    requestAnimationFrame: (run: (at: number) => void) =>
      setTimeout(() => run(Date.now()), 0) as unknown as number,
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { bridge } = await import("../api");
  const { WorldDeskStore } = await import("./deskStateStore");
  const { deskIdentity } = await import("./useDeskState");
  const { reviewStop, useReviewedWork } = await import("./useReviewedWork");
  const { NeedsYouHost, NeedsYouList } = await import("./NeedsYouTab");
  const { closeNeedsYou, openNeedsYou } = await import("./needsYou");
  const { useShownReport } = await import("./shownReport");
  const { initializeLayoutPreferences } = await import("../layoutPreferences");
  const { useTownConversation } = await import("./town/townChat");
  type Leaf = import("./worldObject").WorldLeafObject;
  type Asks = import("./worldAsks").WorldAsksStore;
  afterAll(async () => browser.happyDOM.close());

  const leaf = (id: string, status: Leaf["status"]) =>
    ({
      id,
      kind: "agent",
      nativeId: `w1:${id}`,
      connectionId: "local",
      generation: 1,
      label: `${id}-agent`,
      agentName: id,
      hostLabel: "Example host",
      status,
      stale: false,
      actionable: true,
      lastActivityAt: 1_000,
      terminalId: `terminal-${id}`,
      agentSessionFingerprint: null,
      pane: { pane_id: `w1:${id}`, workspace_id: "w1", tab_id: "t1" },
      stateLabels: {},
    }) as unknown as Leaf;
  const prompt = (fingerprint: string, options: string[]) => ({
    question: ["Which colour?"],
    request: [],
    options: options.map((label, index) => ({
      number: String(index + 1),
      key: String(index + 1),
      label,
    })),
    fingerprint,
  });

  // Conversations by pane; a held read answers when the test releases it,
  // and a failing one throws as a timed-out read does.
  const reports = new Map<string, unknown>();
  let held: { promise: Promise<void>; resolve(): void } | null = null;
  let failRead = false;
  const answers: Record<string, unknown>[] = [];
  // The panes whose conversations the service is asked to watch now.
  const watched = new Set<string>();
  const controls = new Set<(control: Record<string, unknown>) => void>();
  const changed = async (pane: string) => {
    for (const listener of [...controls])
      listener({
        type: "agent_conversation_changed",
        connection_id: "local",
        pane_id: pane,
      });
    await settle();
  };
  const client = {
    connectionId: "local",
    generation: 1,
    serverRuntimeGeneration: null,
    isCurrent: () => true,
    call: async (method: string, params: Record<string, unknown>) => {
      if (method === "agent_conversation.latest") {
        const pane = String(params.pane_id);
        if (pane === "w1:done" && held) await held.promise;
        if (pane === "w1:done" && failRead)
          throw new Error("Herdr request timed out");
        return { status: "ok", ...(reports.get(pane) as object) };
      }
      if (method === "agent_conversation.watch")
        watched.add(String(params.pane_id));
      if (method === "agent_conversation.unwatch")
        watched.delete(String(params.pane_id));
      if (method === "agent_conversation.answer") {
        answers.push(params);
        return {
          status: "sent",
          number: "1",
          label: "Red",
          acknowledged: false,
          unconfirmed_reason: "session_changed",
          prompt_fingerprint: params.prompt_fingerprint,
        };
      }
      return null;
    },
  };
  // Terminal completion checks: the fallback when Desk names no stop.
  const checks: Record<string, unknown>[] = [];
  let seenControl: ((control: Record<string, unknown>) => void) | null = null;
  const seenList = () => ({ revision: checks.length, records: checks });
  Object.assign(bridge, {
    call: async (method: string, params?: Record<string, unknown>) => {
      if (method === "world.completion_seen.list") return seenList();
      if (method === "world.completion_seen.mark") {
        checks.push(params!);
        return seenList();
      }
      return null;
    },
    connection: () => client,
    onControl: (listener: (control: Record<string, unknown>) => void) => {
      controls.add(listener);
      seenControl = listener;
      return () => controls.delete(listener);
    },
    onStatus: () => () => {},
  });

  const done = leaf("done", "done");
  const world = {
    leaves: [leaf("raw", "blocked"), leaf("picky", "blocked"), done],
    nodeById: new Map(),
  };
  // The service's reviewed record for the finished agent: stop s1, then s2.
  let stopId = "s1";
  let failMark = true;
  const marks: Record<string, unknown>[] = [];
  let deskChanged: (() => void) | null = null;
  const deskState = () => ({
    revision: Number(stopId.slice(1)),
    records: [
      {
        ...deskIdentity(done),
        reviewed_stop: null,
        stopped_at: 900,
        observed_stop_id: stopId,
        opened_at: null,
      },
    ],
  });
  const deskStore = new WorldDeskStore({
    call: async (method: string, params?: Record<string, unknown>) => {
      if (method === "world.desk.review") {
        marks.push(params!);
        if (failMark) throw new Error("Desk agent session changed");
      }
      return deskState();
    },
    onControl: (listener: (control: { type: string }) => void) => {
      deskChanged = () => listener({ type: "world_desk_changed" });
      return () => {};
    },
    onStatus: () => () => {},
  } as unknown as ConstructorParameters<typeof WorldDeskStore>[0]);
  const noAsks: never[] = [];
  const asksStore = {
    get: () => noAsks,
    subscribe: () => () => {},
    start: () => {},
    stop: () => {},
  } as unknown as Asks;

  reports.set("w1:raw", {
    latest: { text: "Needs a decision" },
    pending_prompt: prompt("raw-1", []),
  });
  reports.set("w1:picky", {
    latest: { text: "Pick a colour" },
    pending_prompt: prompt("picky-1", ["Red", "Blue"]),
  });
  reports.set("w1:done", { latest: { text: "Report for stop one" } });

  const opened: string[] = [];
  const terminals: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const settle = async () => {
    for (let index = 0; index < 5; index++)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
  };
  await act(async () =>
    root.render(
      createElement(NeedsYouList, {
        world,
        request: { sequence: 0 },
        now: 2_000,
        onChat: (id) => opened.push(id),
        onOpenTerminal: (id) => terminals.push(id),
        asksStore,
        deskStore,
      }),
    ),
  );
  await settle();
  const item = (id: string) =>
    container.querySelector<HTMLElement>(`[data-needs-you-item="leaf:${id}"]`)!;
  const button = (scope: HTMLElement, text: string) =>
    [...scope.querySelectorAll<HTMLButtonElement>("button")].find((entry) =>
      // An icon button is found by its tooltip.
      `${entry.textContent} ${entry.title}`.includes(text),
    )!;

  test("a prompt Chat cannot answer opens the Terminal, not Chat", async () => {
    await act(async () =>
      button(item("raw"), "Answer in the Terminal").click(),
    );
    expect(terminals).toEqual(["raw"]);
    expect(opened).toEqual([]);
  });

  test("an unconfirmed answer says so and offers the Terminal", async () => {
    terminals.length = 0;
    await act(async () => button(item("picky"), "Red").click());
    await settle();
    expect(answers).toEqual([
      { pane_id: "w1:picky", key: "1", prompt_fingerprint: "picky-1" },
    ]);
    const text = item("picky").textContent!;
    expect(text).toContain("Sent");
    expect(text).not.toContain("You answered");
    expect(text).toContain("the pane has another session now");
    await act(async () => button(item("picky"), "Open Terminal").click());
    expect(terminals).toEqual(["picky"]);
  });

  test("Mark reviewed waits for the current stop's report and reports a failed save", async () => {
    const mark = () => button(item("done"), "Mark reviewed");
    expect(mark().disabled).toBe(false);
    // The service sees a new stop; its report is still being read.
    held = Promise.withResolvers<void>();
    stopId = "s2";
    await act(async () => deskChanged!());
    await settle();
    expect(item("done").textContent).toContain("Report for stop one");
    expect(mark().disabled).toBe(true);
    reports.set("w1:done", { latest: { text: "Report for stop two" } });
    held.resolve();
    held = null;
    await settle();
    expect(item("done").textContent).toContain("Report for stop two");
    expect(mark().disabled).toBe(false);
    // A save that fails is not shown as reviewed.
    await act(async () => mark().click());
    await settle();
    expect(item("done").querySelector('[role="alert"]')?.textContent).toContain(
      "Could not save the review mark",
    );
    // The mark names the stop whose report is shown.
    const stopTwo = reviewStop(done, deskState().records[0]);
    expect(marks[marks.length - 1]).toMatchObject({
      stop_id: stopTwo,
      reviewed: true,
    });
    failMark = false;
    await act(async () => mark().click());
    await settle();
    expect(item("done").querySelector('[role="alert"]')).toBeNull();
  });

  test("a different question brings back an earlier question's answers", async () => {
    // Picky was answered on picky-1 (unconfirmed); the menu cursor moves, so
    // Herdr reports another question, then the first one again.
    reports.set("w1:picky", {
      latest: { text: "Pick a colour" },
      pending_prompt: prompt("picky-2", ["Green", "Yellow"]),
    });
    await changed("w1:picky");
    expect(button(item("picky"), "Green")).toBeDefined();
    expect(item("picky").textContent).not.toContain("another session now");
    reports.set("w1:picky", {
      latest: { text: "Pick a colour" },
      pending_prompt: prompt("picky-1", ["Red", "Blue"]),
    });
    await changed("w1:picky");
    expect(button(item("picky"), "Red").disabled).toBe(false);
    expect(item("picky").textContent).not.toContain("another session now");
  });

  test("a report that cannot be read says so and can be read again", async () => {
    const mark = () => button(item("done"), "Mark reviewed");
    failRead = true;
    stopId = "s3";
    await act(async () => deskChanged!());
    await settle();
    expect(mark().disabled).toBe(true);
    expect(item("done").querySelector('[role="alert"]')?.textContent).toBe(
      "Could not read the latest report.",
    );
    // The finished agent's conversation never changes; Retry reads again.
    failRead = false;
    reports.set("w1:done", { latest: { text: "Report for stop three" } });
    await act(async () => button(item("done"), "Retry").click());
    await settle();
    expect(item("done").textContent).toContain("Report for stop three");
    expect(mark().disabled).toBe(false);
    expect(item("done").querySelector('[role="alert"]')).toBeNull();
    await act(async () => root.unmount());
    expect(watched.size).toBe(0);
  });

  test("pages bound the conversations watched in a dense World", async () => {
    const crowd = Array.from({ length: 70 }, (_, index) =>
      leaf(`p${index + 1}`, "blocked"),
    );
    const dense = { leaves: crowd, nodeById: new Map() };
    const host = document.createElement("div");
    document.body.append(host);
    const pages = createRoot(host);
    await act(async () =>
      pages.render(
        createElement(NeedsYouList, {
          world: dense,
          request: { sequence: 0 },
          now: 2_000,
          onChat: () => {},
          onOpenTerminal: () => {},
          asksStore,
          deskStore,
        }),
      ),
    );
    await settle();
    const turn = async (text: string) => {
      await act(async () => button(host, text).click());
      await settle();
    };
    const first = new Set(watched);
    expect(first.size).toBe(30);
    await turn("Show 30 more of 40");
    const second = new Set(watched);
    expect(second.size).toBe(30);
    expect([...second].some((pane) => first.has(pane))).toBe(false);
    await turn("Show 10 more of 10");
    expect(watched.size).toBe(10);
    await turn("Show the 30 before");
    expect(watched).toEqual(second);
    await act(async () => pages.unmount());
    expect(watched.size).toBe(0);
  });

  test("asking again for the same item turns back to its page", async () => {
    const crowd = Array.from({ length: 70 }, (_, index) =>
      leaf(`r${index + 1}`, "blocked"),
    );
    const dense = { leaves: crowd, nodeById: new Map() };
    const host = document.createElement("div");
    document.body.append(host);
    const pages = createRoot(host);
    const render = (sequence: number) =>
      act(async () =>
        pages.render(
          createElement(NeedsYouList, {
            world: dense,
            request: { itemKey: "leaf:r45", sequence },
            now: 2_000,
            onChat: () => {},
            onOpenTerminal: () => {},
            asksStore,
            deskStore,
          }),
        ),
      );
    const shown = () =>
      host.querySelector('[data-needs-you-item="leaf:r45"]')?.className ?? "";
    await render(1);
    await settle();
    expect(shown()).toContain("is-focused");
    await act(async () => button(host, "Show the 30 before").click());
    await settle();
    expect(shown()).toBe("");
    // Desk's Answer (or Board, or reception) for the same agent again.
    await render(2);
    await settle();
    expect(shown()).toContain("is-focused");
    expect(watched.size).toBe(30);
    await act(async () => pages.unmount());
    expect(watched.size).toBe(0);
  });

  test("work Desk names no stop for is checked on its terminal, and leaves", async () => {
    const quiet = {
      ...leaf("quiet", "done"),
      lastActivityAt: undefined,
    } as unknown as Leaf;
    reports.set("w1:quiet", { latest: { text: "Quiet report" } });
    const host = document.createElement("div");
    document.body.append(host);
    const list = createRoot(host);
    const emptyDesk = new WorldDeskStore({
      call: async () => ({ revision: 1, records: [] }),
      onControl: () => () => {},
      onStatus: () => () => {},
    } as unknown as ConstructorParameters<typeof WorldDeskStore>[0]);
    await act(async () =>
      list.render(
        createElement(NeedsYouList, {
          world: { leaves: [quiet], nodeById: new Map() },
          request: { sequence: 0 },
          now: 2_000,
          onChat: () => {},
          onOpenTerminal: () => {},
          asksStore,
          deskStore: emptyDesk,
        }),
      ),
    );
    await settle();
    const quietItem = () =>
      host.querySelector<HTMLElement>('[data-needs-you-item="leaf:quiet"]');
    await act(async () => button(quietItem()!, "Mark reviewed").click());
    await settle();
    expect(checks).toEqual([
      {
        connection_id: "local",
        connection_generation: 1,
        terminal_id: "terminal-quiet",
      },
    ]);
    seenControl?.({ type: "world_completion_seen_changed" });
    await settle();
    expect(quietItem()).toBeNull();
    await act(async () => list.unmount());
  });

  test("Town's conversation read drops a reply that answers an older read", async () => {
    const town = leaf("town", "working");
    let release: (() => void) | null = null;
    let reads = 0;
    reports.set("w1:town", { latest: { text: "First" } });
    const realCall = client.call;
    client.call = async (method, params) => {
      if (
        method === "agent_conversation.latest" &&
        params.pane_id === "w1:town"
      ) {
        reads++;
        if (reads === 1) {
          const answer = { status: "ok", latest: { text: "Stale" } };
          await new Promise<void>((resolve) => (release = resolve));
          return answer;
        }
      }
      return realCall(method, params);
    };
    let text = null as string | null;
    const Probe = () => {
      text = useTownConversation(town, true)?.latest?.text ?? null;
      return null;
    };
    const probeRoot = createRoot(document.createElement("div"));
    await act(async () => probeRoot.render(createElement(Probe)));
    await settle();
    // A change notice reads again before the first read answers.
    await changed("w1:town");
    expect(text).toBe("First");
    release!();
    await settle();
    expect(text).toBe("First");
    client.call = realCall;
    await act(async () => probeRoot.unmount());
  });

  /** Renders the list alone for one case and returns its item lookup. */
  const listFor = async (leaves: Leaf[]) => {
    const host = document.createElement("div");
    document.body.append(host);
    const list = createRoot(host);
    const render = (shown: Leaf[]) =>
      act(async () =>
        list.render(
          createElement(NeedsYouList, {
            world: { leaves: shown, nodeById: new Map() },
            request: { sequence: 0 },
            now: 2_000,
            onChat: () => {},
            onOpenTerminal: () => {},
            asksStore,
            deskStore,
          }),
        ),
      );
    await render(leaves);
    await settle();
    const of = (id: string) =>
      host.querySelector<HTMLElement>(`[data-needs-you-item="leaf:${id}"]`)!;
    return { host, of, render, unmount: () => act(async () => list.unmount()) };
  };

  test("a report the service could not read is a failed read, never the new stop's report", async () => {
    stopId = "s4";
    reports.set("w1:done", { latest: { text: "Report for stop four" } });
    const view = await listFor([done]);
    const mark = () => button(view.of("done"), "Mark reviewed");
    expect(mark().disabled).toBe(false);
    // The service answers a read of the new stop with its read_failed shape.
    stopId = "s5";
    reports.set("w1:done", {
      status: "unavailable",
      latest: null,
      pending_prompt: null,
      unavailable: {
        reason: "read_failed",
        detail: "Could not read transcript",
      },
    });
    await act(async () => deskChanged!());
    await settle();
    expect(mark().disabled).toBe(true);
    expect(view.of("done").textContent).toContain("Report for stop four");
    expect(view.of("done").textContent).toContain("Retry");
    reports.set("w1:done", { latest: { text: "Report for stop five" } });
    await act(async () => button(view.of("done"), "Retry").click());
    await settle();
    expect(mark().disabled).toBe(false);
    expect(view.of("done").textContent).toContain("Report for stop five");
    await view.unmount();
  });

  test("a new agent session on the pane inherits no answer, question or late result", async () => {
    reports.set("w1:picky", {
      latest: { text: "Pick a colour" },
      pending_prompt: prompt("picky-9", ["Red", "Blue"]),
    });
    const picky = leaf("picky", "blocked");
    const view = await listFor([picky]);
    await act(async () => button(view.of("picky"), "Red").click());
    await settle();
    expect(view.of("picky").textContent).toContain("Sent");
    const replaced = (fingerprint: string) =>
      ({ ...picky, agentSessionFingerprint: fingerprint }) as Leaf;
    reports.set("w1:picky", {
      latest: { text: "New session" },
      pending_prompt: null,
    });
    await view.render([replaced("b".repeat(64))]);
    await settle();
    expect(view.of("picky").textContent).toContain("New session");
    expect(view.of("picky").textContent).not.toContain("Sent");
    // An answer still in flight when the session changes never lands.
    reports.set("w1:picky", {
      latest: { text: "Pick again" },
      pending_prompt: prompt("picky-10", ["Red", "Blue"]),
    });
    await changed("w1:picky");
    const realCall = client.call;
    let release: (() => void) | null = null;
    client.call = async (method, params) => {
      if (method === "agent_conversation.answer")
        await new Promise<void>((resolve) => (release = resolve));
      return realCall(method, params);
    };
    await act(async () => button(view.of("picky"), "Red").click());
    reports.set("w1:picky", {
      latest: { text: "Third session" },
      pending_prompt: null,
    });
    await view.render([replaced("c".repeat(64))]);
    await settle();
    release!();
    await settle();
    client.call = realCall;
    expect(view.of("picky").textContent).toContain("Third session");
    expect(view.of("picky").textContent).not.toContain("Sent");
    await view.unmount();
  });

  test("Town's peek names the stop whose report it shows, and waits for a new one", async () => {
    stopId = "s6";
    reports.set("w1:done", { latest: { text: "Report six" } });
    let shown: { stop: string | null; text: string | null; failed: boolean } = {
      stop: null,
      text: null,
      failed: false,
    };
    let markShown: ReturnType<typeof useShownReport>["markShown"] | null = null;
    const townMarks: string[] = [];
    const townMark = async (_: Leaf, stop: string) => (
      townMarks.push(stop), true
    );
    const Probe = () => {
      const report = useShownReport(done, true, true, deskStore);
      markShown = report.markShown;
      shown = {
        stop: report.stop,
        text: report.conversation?.latest?.text ?? null,
        failed: report.failed,
      };
      return null;
    };
    const probe = createRoot(document.createElement("div"));
    await act(async () => probe.render(createElement(Probe)));
    await settle();
    const stopSix = reviewStop(done, deskState().records[0]);
    expect(shown).toEqual({ stop: stopSix, text: "Report six", failed: false });
    // The service sees stop seven while its report is still being read.
    held = Promise.withResolvers<void>();
    stopId = "s7";
    await act(async () => deskChanged!());
    await settle();
    expect(shown).toEqual({ stop: null, text: "Report six", failed: false });
    // Town's Mark reviewed marks nothing while the new report is read.
    expect(await markShown!(townMark, "builder", () => {})).toBe(false);
    expect(townMarks).toEqual([]);
    reports.set("w1:done", { latest: { text: "Report seven" } });
    held.resolve();
    held = null;
    await settle();
    expect(shown.stop).toBe(reviewStop(done, deskState().records[0]));
    expect(shown.stop).not.toBe(stopSix);
    expect(shown.text).toBe("Report seven");
    expect(await markShown!(townMark, "builder", () => {})).toBe(true);
    expect(townMarks).toEqual([shown.stop!]);
    await act(async () => probe.unmount());
  });

  test("the phone list takes focus, keeps the app behind it inert and gives focus back", async () => {
    Object.defineProperty(window, "innerWidth", {
      value: 390,
      configurable: true,
    });
    initializeLayoutPreferences();
    closeNeedsYou();
    const app = document.createElement("div");
    document.body.append(app);
    const shell = createRoot(app);
    await act(async () =>
      shell.render(
        createElement(
          "div",
          null,
          createElement(
            "button",
            { id: "opener", onClick: () => openNeedsYou("leaf:picky") },
            "Open Needs you",
          ),
          createElement(NeedsYouHost, {
            world,
            onChat: () => {},
            onOpenTerminal: () => {},
          }),
        ),
      ),
    );
    const opener = app.querySelector<HTMLButtonElement>("#opener")!;
    opener.focus();
    await act(async () => opener.click());
    await settle();
    const sheet = () =>
      document.querySelector<HTMLElement>(
        '.needs-you-tab.is-sheet[aria-modal="true"]',
      );
    expect(sheet()).not.toBeNull();
    expect(sheet()!.contains(document.activeElement)).toBe(true);
    expect(
      sheet()!
        .querySelector('[data-needs-you-item="leaf:picky"]')!
        .contains(document.activeElement),
    ).toBe(true);
    expect(app.hasAttribute("inert")).toBe(true);
    // Back's button, focused in the list, is where Chat returns to.
    const back = sheet()!.querySelector<HTMLButtonElement>(".needs-you-back")!;
    back.focus();
    // Chat about this opened an agent window over the list.
    const chat = document.createElement("div");
    chat.className = "world-managed-window";
    app.append(chat);
    await settle();
    expect(app.hasAttribute("inert")).toBe(false);
    chat.remove();
    await settle();
    expect(app.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(back);
    // Back closes the list and returns focus to its opener.
    await act(async () => closeNeedsYou());
    await settle();
    expect(sheet()).toBeNull();
    expect(app.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(opener);
    // The phone's picker re-renders its counter while an agent window is
    // open: closing then focuses the counter that replaced the opener.
    const counter = document.createElement("button");
    counter.className = "needs-you-counter";
    app.append(counter);
    opener.focus();
    await act(async () => opener.click());
    await settle();
    opener.remove();
    await act(async () => closeNeedsYou());
    await settle();
    expect(document.activeElement).toBe(counter);
    await act(async () => shell.unmount());
    app.remove();
  });

  test("Town's reviewed view ignores stop observations and follows review marks", async () => {
    // The service publishes a Desk change for every stop it sees; in a dense
    // Town only a changed review mark may re-render Town.
    let state: {
      revision: number;
      records: import("../../../shared/deskState").DeskRecord[];
    } = { revision: 1, records: [{ ...deskState().records[0]! }] };
    let changed: (() => void) | null = null;
    const store = new WorldDeskStore({
      call: async () => structuredClone(state),
      onControl: (listener: (control: { type: string }) => void) => {
        changed = () => listener({ type: "world_desk_changed" });
        return () => {};
      },
      onStatus: () => () => {},
    } as unknown as ConstructorParameters<typeof WorldDeskStore>[0]);
    let renders = 0;
    let reviewedNow = false;
    const Probe = () => {
      renders++;
      reviewedNow = useReviewedWork(store, false).reviewed(done);
      return null;
    };
    const probeRoot = createRoot(document.createElement("div"));
    await act(async () => probeRoot.render(createElement(Probe)));
    await settle();
    const settled = renders;
    state = {
      revision: 2,
      records: [{ ...state.records[0]!, stopped_at: 950 }],
    };
    await act(async () => changed!());
    await settle();
    expect(renders).toBe(settled);
    const record = state.records[0]!;
    state = {
      revision: 3,
      records: [{ ...record, reviewed_stop: reviewStop(done, record) }],
    };
    await act(async () => changed!());
    await settle();
    expect(renders).toBeGreaterThan(settled);
    expect(reviewedNow).toBe(true);
    await act(async () => probeRoot.unmount());
  });
}
