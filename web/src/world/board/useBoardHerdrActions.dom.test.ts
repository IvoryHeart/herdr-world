import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { boardBarPane, swappedRoomSpots } from "./useBoardHerdrActions";
import { fixtureHost, fixtureWorld } from "./boardFixture";
import { projectBoard } from "./boardModel";

test("Town's saved spots swap for a Herdr step only when Town placed both rooms", () => {
  const pins = {
    "local:w1": { x: 2, y: 3 },
    "local:w2": { x: 20, y: 3 },
    "local:w3": { x: 2, y: 14 },
    "other:w1": { x: 9, y: 9 },
  };
  const host = ["local:w1", "local:w2", "local:w3"];
  // Only this host's spots are saved again (room.place replaces a host's).
  expect(swappedRoomSpots(pins, host, "local:w2", "local:w1")).toEqual({
    "local:w1": { x: 20, y: 3 },
    "local:w2": { x: 2, y: 3 },
    "local:w3": { x: 2, y: 14 },
  });
  // Town stacks unplaced rooms in Herdr's order: nothing to save.
  expect(swappedRoomSpots({}, host, "local:w2", "local:w1")).toBeNull();
  expect(
    swappedRoomSpots(
      { "local:w1": { x: 2, y: 3 } },
      host,
      "local:w2",
      "local:w1",
    ),
  ).toBeNull();
});

test("a tab's bar acts on the selected pane, else on its first agent", () => {
  const model = projectBoard(
    fixtureWorld([
      fixtureHost("local", [
        {
          label: "A",
          tabs: [
            { label: "pair", panes: [["idle", false], ["done"], ["working"]] },
          ],
        },
      ]),
    ]),
  );
  const tab = model.tabs[0]!;
  expect(boardBarPane(tab, null)?.leaf.nativeId).toBe("w1:p2");
  expect(boardBarPane(tab, tab.panes[2]!.leaf.id)?.leaf.nativeId).toBe("w1:p3");
});

if (process.env.BOARD_HERDR_DOM_TEST !== "1") {
  test("Board's bar offers Town's room, order and review actions", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, BOARD_HERDR_DOM_TEST: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  }, 15_000);
} else {
  test("rename, close, Herdr order and Mark reviewed from Board's bar", async () => {
    const browser = new Window({ url: "https://world.example.test" });
    for (const [key, value] of Object.entries({
      window: browser,
      document: browser.document,
      navigator: browser.navigator,
      HTMLElement: browser.HTMLElement,
      HTMLInputElement: browser.HTMLInputElement,
      HTMLTextAreaElement: browser.HTMLTextAreaElement,
      Element: browser.Element,
      Node: browser.Node,
      KeyboardEvent: browser.KeyboardEvent,
      requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
      cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
      getComputedStyle: browser.getComputedStyle.bind(browser),
      IS_REACT_ACT_ENVIRONMENT: true,
    }))
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      });
    const { act, createElement: h, useRef } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { bridge } = await import("../../api");
    const { WorldDeskStore } = await import("../deskStateStore");
    const { useBoardHerdrActions } = await import("./useBoardHerdrActions");
    const { boardKey } = await import("./boardModel");

    const calls: [string, string, unknown][] = [];
    bridge.connection = ((connectionId: string, generation: number) => ({
      connectionId,
      generation,
      serverRuntimeGeneration: generation,
      isCurrent: () => true,
      acceptsServerGeneration: () => true,
      call: async (method: string, params: unknown) => {
        calls.push([`${connectionId}@${generation}`, method, params]);
        if (method === "workspace.list")
          return {
            workspaces: [
              { workspace_id: "w1", number: 1 },
              { workspace_id: "w2", number: 2 },
            ],
          };
        return { type: "ok" };
      },
    })) as unknown as typeof bridge.connection;

    const world = fixtureWorld([
      fixtureHost("local", [
        {
          label: "Alpha",
          tabs: [
            { label: "build", panes: [["done"]] },
            { label: "docs", panes: [["working"]] },
            { label: "fixed", panes: [["idle"]] },
            { label: "rested", panes: [["idle"]] },
          ],
        },
        { label: "Beta", tabs: [{ label: "shell", panes: [["idle", false]] }] },
      ]),
    ]);
    const model = projectBoard(world);
    const done = model.tabs[0]!.panes[0]!.leaf;
    // The service's Desk state: the finished agent's stop, not yet reviewed.
    const record = {
      connection_id: done.connectionId,
      connection_generation: done.generation,
      terminal_id: done.terminalId,
      agent_session_fingerprint: null,
      reviewed_stop: null as string | null,
      stopped_at: 1_000,
      observed_stop_id: "stop-1",
      opened_at: null,
    };
    // Herdr reports a finished turn as idle once seen: an idle agent whose
    // turn the service saw end recently waits for review too, as Town and
    // Needs you count it; one that stopped long ago does not.
    const stopped = (tab: number, at: number, id: string) => {
      const leaf = model.tabs[tab]!.panes[0]!.leaf;
      return {
        connection_id: leaf.connectionId,
        connection_generation: leaf.generation,
        terminal_id: leaf.terminalId,
        agent_session_fingerprint: null,
        reviewed_stop: null as string | null,
        stopped_at: at,
        observed_stop_id: id,
        opened_at: null,
      };
    };
    const fixedRecord = stopped(2, Date.now() - 60_000, "stop-fixed");
    const restedRecord = stopped(3, Date.now() - 24 * 3_600_000, "stop-old");
    const deskCalls: [string, Record<string, unknown> | undefined][] = [];
    const deskStore = new WorldDeskStore({
      call: async (method, params) => {
        deskCalls.push([method, params]);
        const marked = [record, fixedRecord, restedRecord].find(
          (candidate) => candidate.terminal_id === params?.terminal_id,
        );
        if (method === "world.desk.review" && marked)
          marked.reviewed_stop = String(params?.stop_id);
        return {
          revision: deskCalls.length,
          records: [record, fixedRecord, restedRecord],
        };
      },
      onControl: () => () => {},
      onStatus: () => () => {},
    });
    const patches: unknown[] = [];
    const boardStore = {
      get: () => ({
        document: {
          layout: {
            room_pins: {
              "local:w1": { x: 2, y: 3 },
              "local:w2": { x: 20, y: 3 },
            },
          },
        },
      }),
      patch: async (ops: unknown[]) => {
        patches.push(...ops);
        return null;
      },
    } as never;
    const notices: string[] = [];

    function Harness({ keys }: { keys: string[] }) {
      const boardRef = useRef<HTMLDivElement>(null);
      const herdr = useBoardHerdrActions({
        model,
        selectedId: null,
        boardStore,
        boardRef,
        notify: (_kind, text) => notices.push(text),
        onOpen: () => {},
        deskStore,
      });
      return h(
        "div",
        { ref: boardRef },
        ...keys.map((key) =>
          h("div", { key, "data-bar": key }, herdr.barItems(key)),
        ),
        herdr.overlay,
        herdr.dialogs,
      );
    }
    const settle = () =>
      act(async () => {
        for (let i = 0; i < 5; i += 1) await Promise.resolve();
      });
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    const buttons = (scope: string) =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          `[data-bar="${scope}"] button`,
        ),
      ].map(
        (button) => `${button.textContent}${button.disabled ? " (off)" : ""}`,
      );
    const press = async (scope: string, label: string) => {
      const button = [
        ...document.querySelectorAll<HTMLButtonElement>(
          `[data-bar="${scope}"] button`,
        ),
      ].find((candidate) => candidate.textContent === label)!;
      await act(async () => button.click());
      await settle();
    };

    const alpha = boardKey("local", "w1");
    const build = model.tabs[0]!.key;
    const fixed = model.tabs[2]!.key;
    const rested = model.tabs[3]!.key;
    await act(async () =>
      root.render(h(Harness, { keys: [alpha, build, fixed, rested] })),
    );
    await settle();

    // A room: Town's rename and close, and its place in Herdr's order.
    expect(buttons(alpha)).toEqual([
      "Rename…",
      "Close…",
      "‹ Earlier (off)",
      "Later ›",
    ]);
    await press(alpha, "Close…");
    expect(document.body.textContent).toContain(
      "Close room “Alpha”? Its running terminal sessions will end.",
    );
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Cancel")
        ?.click(),
    );
    await press(alpha, "Rename…");
    expect(document.querySelector<HTMLInputElement>("input")?.value).toBe(
      "Alpha",
    );

    // Later: Herdr moves the room on its own host and generation, and Town's
    // saved spots swap so its buildings read in the same order.
    await press(alpha, "Later ›");
    expect(calls).toEqual([
      ["local@1", "workspace.list", {}],
      ["local@1", "workspace.move", { workspace_id: "w2", insert_index: 0 }],
    ]);
    expect(patches).toEqual([
      {
        op: "room.place",
        connection_id: "local",
        spots: { "local:w1": { x: 20, y: 3 }, "local:w2": { x: 2, y: 3 } },
      },
    ]);
    expect(notices[notices.length - 1]).toContain(
      "Moved “Alpha” later in Herdr.",
    );

    // A finished agent's tab: a peek, Mark reviewed and its tab's order.
    expect(buttons(build)).toEqual([
      "Preview",
      "Mark reviewed",
      "‹ Earlier (off)",
      "Later ›",
    ]);
    await press(build, "Mark reviewed");
    expect(deskCalls[deskCalls.length - 1]?.[0]).toBe("world.desk.review");
    expect(deskCalls[deskCalls.length - 1]?.[1]).toMatchObject({
      terminal_id: done.terminalId,
      reviewed: true,
    });
    // The reviewed record ends the offer, as it ends Town's reception.
    expect(buttons(build)).not.toContain("Mark reviewed");
    expect(notices[notices.length - 1]).toBe("agent's work reviewed");

    // An idle agent that finished a turn recently: Mark reviewed, as Town
    // presents it at reception; one idle since long ago: no offer.
    expect(buttons(fixed)).toContain("Mark reviewed");
    expect(buttons(rested)).not.toContain("Mark reviewed");
    await press(fixed, "Mark reviewed");
    expect(deskCalls[deskCalls.length - 1]?.[1]).toMatchObject({
      terminal_id: fixedRecord.terminal_id,
      reviewed: true,
    });

    await act(async () => root.unmount());
  });
}
