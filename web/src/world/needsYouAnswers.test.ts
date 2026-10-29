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
    "KeyboardEvent",
    "MouseEvent",
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
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { bridge } = await import("../api");
  const { WorldDeskStore } = await import("./deskStateStore");
  const { deskIdentity } = await import("./useDeskState");
  const { reviewStop } = await import("./useReviewedWork");
  const { NeedsYouWindow } = await import("./NeedsYouWindow");
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

  // Conversations by pane; a held read answers when the test releases it.
  const reports = new Map<string, unknown>();
  let held: { promise: Promise<void>; resolve(): void } | null = null;
  const answers: Record<string, unknown>[] = [];
  const client = {
    connectionId: "local",
    generation: 1,
    serverRuntimeGeneration: null,
    isCurrent: () => true,
    call: async (method: string, params: Record<string, unknown>) => {
      if (method === "agent_conversation.latest") {
        const pane = String(params.pane_id);
        if (pane === "w1:done" && held) await held.promise;
        return { status: "ok", ...(reports.get(pane) as object) };
      }
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
  Object.assign(bridge, {
    connection: () => client,
    onControl: () => () => {},
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
    revision: stopId === "s1" ? 1 : 2,
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
      createElement(NeedsYouWindow, {
        world,
        now: 2_000,
        onOpenAgent: (id) => opened.push(id),
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
      entry.textContent!.includes(text),
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
    await act(async () => root.unmount());
  });
}
