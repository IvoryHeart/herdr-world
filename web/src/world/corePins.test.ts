import { describe, expect, test } from "bun:test";
import type {
  BoardDocumentStore,
  BoardOp,
  DeskPin,
} from "./board/boardDocument";
import {
  CORE_PIN_FAILED,
  CORE_PIN_STALE,
  coreCardPinChanges,
  corePinsOf,
  corePinWrites,
  coreTabPinOf,
  setCoreTabPinned,
  withCorePins,
  type CorePins,
} from "./corePins";
import type { WorldRuntimeConnection } from "./runtimeStore";
import { setDeskPinned } from "./useDeskPins";

// Synthetic hosts and terminals only.
const pane = (
  tab: string,
  terminal: string,
  extra: { agent?: string; favourite?: boolean } = {},
) => ({
  workspace_id: "w1",
  tab_id: tab,
  pane_id: terminal,
  terminal_id: terminal,
  runtime: "herdr-core",
  ...extra,
});

const core = (
  panes: ReturnType<typeof pane>[],
  extra: Partial<WorldRuntimeConnection> = {},
) =>
  ({
    connectionId: "box-core",
    runtime: "herdr-core",
    state: "ready",
    stale: false,
    generation: 3,
    snapshot: {
      workspaces: [{ workspace_id: "w1" }],
      tabs: [...new Set(panes.map((p) => p.tab_id))].map((tab_id) => ({
        workspace_id: "w1",
        tab_id,
      })),
      panes,
    },
    ...extra,
  }) as unknown as WorldRuntimeConnection;

const tui = {
  connectionId: "tui",
  state: "ready",
  stale: false,
  generation: 1,
  snapshot: {
    workspaces: [{ workspace_id: "w1" }],
    tabs: [{ workspace_id: "w1", tab_id: "t1" }],
    panes: [{ ...pane("t1", "p1", { agent: "claude" }), runtime: undefined }],
  },
} as unknown as WorldRuntimeConnection;

describe("one pin for herdr-core agents", () => {
  test("a core desk is pinned while any of its terminals is; Herdr tabs have no runtime pin", () => {
    const pins = corePinsOf([
      tui,
      core([
        pane("t1", "a1", { agent: "claude", favourite: true }),
        pane("t1", "s1"),
        pane("t2", "a2", { agent: "codex" }),
      ]),
    ]);
    expect([...pins.keys()]).toEqual(["box-core:t1", "box-core:t2"]);
    expect(pins.get("box-core:t1")).toMatchObject({
      connectionId: "box-core",
      generation: 3,
      live: true,
      pinned: true,
    });
    expect(pins.get("box-core:t2")!.pinned).toBe(false);
    expect(coreTabPinOf(pins, "box-core", "s1")).toBe(pins.get("box-core:t1")!);
    expect(coreTabPinOf(pins, "tui", "p1")).toBeNull();
    // A stale host keeps its last pins for display, not to act on.
    const stale = corePinsOf([
      core([pane("t1", "a1", { favourite: true })], { stale: true }),
    ]);
    expect(stale.get("box-core:t1")).toMatchObject({
      live: false,
      pinned: true,
    });
  });

  test("Town shows a core desk pinned exactly when its label is", () => {
    const pins = corePinsOf([
      core([
        pane("t1", "a1", { favourite: true }),
        pane("t2", "a2"),
        pane("t3", "a3", { favourite: true }),
      ]),
    ]);
    const saved: Record<string, DeskPin> = {
      "box-core:t1": { cell: { col: 2, row: 1 } },
      "box-core:t2": { cell: { col: 4, row: 1 } },
      "tui:t1": { cell: null },
    };
    expect(withCorePins(saved, pins)).toEqual({
      "box-core:t1": { cell: { col: 2, row: 1 } },
      "box-core:t3": { cell: null },
      "tui:t1": { cell: null },
    });
    // Nothing to change: the saved pins keep their identity.
    const settled = {
      "box-core:t1": { cell: null },
      "box-core:t3": { cell: null },
    };
    expect(withCorePins(settled, pins)).toBe(settled);
  });

  test("Board pins and unpins core cards to match their labels, only cards it placed on live cores", () => {
    const pins = corePinsOf([
      core([
        pane("t1", "a1", { favourite: true }),
        pane("t2", "a2"),
        pane("t3", "a3", { favourite: true }),
      ]),
    ]);
    const pinned = new Map([
      ["box-core:t2", { x: 0, y: 0 }],
      ["tui:t1", { x: 0, y: 0 }],
    ]);
    expect(
      coreCardPinChanges(pinned, pins, (key) => key !== "box-core:t3"),
    ).toEqual({ pin: ["box-core:t1"], unpin: ["box-core:t2"] });
    const stale = corePinsOf([
      core([pane("t1", "a1", { favourite: true })], { stale: true }),
    ]);
    expect(coreCardPinChanges(new Map(), stale, () => true)).toEqual({
      pin: [],
      unpin: [],
    });
  });

  test("pinning a desk pins its agents (or its terminals); unpinning clears every terminal", () => {
    const mixed = corePinsOf([
      core([
        pane("t1", "a1", { agent: "claude" }),
        pane("t1", "s1"),
        pane("t1", "a2", { agent: "codex", favourite: true }),
      ]),
    ]).get("box-core:t1")!;
    expect(corePinWrites(mixed, true)).toEqual([
      {
        connection_id: "box-core",
        connection_generation: 3,
        terminal: "a1",
        favourite: true,
      },
    ]);
    const shells = corePinsOf([core([pane("t1", "s1"), pane("t1", "s2")])]).get(
      "box-core:t1",
    )!;
    expect(corePinWrites(shells, true).map((w) => w.terminal)).toEqual([
      "s1",
      "s2",
    ]);
    const app = corePinsOf([
      core([
        pane("t1", "a1", { agent: "claude" }),
        pane("t1", "s1", { favourite: true }),
      ]),
    ]).get("box-core:t1")!;
    expect(corePinWrites(app, false)).toEqual([
      {
        connection_id: "box-core",
        connection_generation: 3,
        terminal: "s1",
        favourite: false,
      },
    ]);
  });

  test("writes go to the service fenced by generation; failures and stale hosts say so", async () => {
    const pin = corePinsOf([
      core([
        pane("t1", "a1", { agent: "claude" }),
        pane("t1", "a2", { agent: "codex" }),
      ]),
    ]).get("box-core:t1")!;
    const calls: unknown[][] = [];
    const notices: string[] = [];
    const ok = await setCoreTabPinned(
      pin,
      true,
      async (...args) => {
        calls.push(args);
        return { written: true };
      },
      (message) => notices.push(message),
    );
    expect(ok).toBe(true);
    expect(
      calls.map(([method, params]) => [
        method,
        (params as { terminal: string }).terminal,
      ]),
    ).toEqual([
      ["world.core.favourite", "a1"],
      ["world.core.favourite", "a2"],
    ]);
    expect(notices).toEqual([]);

    const failed = await setCoreTabPinned(
      pin,
      true,
      async (_method, params) => {
        if (params.terminal === "a2") throw new Error("refused");
        return { written: true };
      },
      (message) => notices.push(message),
    );
    expect(failed).toBe(false);
    expect(notices).toEqual([CORE_PIN_FAILED]);

    const stale = { ...pin, live: false };
    calls.length = 0;
    expect(
      await setCoreTabPinned(
        stale,
        true,
        async (...args) => calls.push(args),
        (message) => notices.push(message),
      ),
    ).toBe(false);
    expect(calls).toEqual([]);
    expect(notices[notices.length - 1]).toBe(CORE_PIN_STALE);
  });
});

// The rule has no ordering of its own: every view is a pure function of one
// runtime observation and World's saved positions, so checking every
// combination is exhaustive (openspec/changes/herdr-core-runtime/model.md).
test("every observation: shown pin is the label, stale never writes", async () => {
  const cells = [undefined, null, { col: 1, row: 1 }] as const;
  for (const live of [true, false])
    for (const labels of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ])
      for (const cell of cells) {
        const pins = corePinsOf([
          core(
            [
              pane("t1", "a1", { agent: "claude", favourite: labels[0] }),
              pane("t1", "s1", { favourite: labels[1] }),
            ],
            live ? {} : { stale: true },
          ),
        ]);
        const pinned = labels.some(Boolean);
        const saved: Record<string, DeskPin> =
          cell === undefined ? {} : { "box-core:t1": { cell } };
        const what = JSON.stringify({ live, labels, cell });
        const shown = withCorePins(saved, pins)["box-core:t1"];
        expect(Boolean(shown), what).toBe(pinned);
        if (shown) expect(shown.cell ?? null, what).toEqual(cell ?? null);
        for (const want of [true, false]) {
          const sent: unknown[] = [];
          await setCoreTabPinned(
            pins.get("box-core:t1")!,
            want,
            async (_m, params) => sent.push(params),
            () => {},
          );
          const after = labels.map((was, i) =>
            sent.some(
              (p) => (p as { terminal: string }).terminal === ["a1", "s1"][i],
            )
              ? want
              : was,
          );
          if (!live) expect(sent, what).toEqual([]);
          else expect(after.some(Boolean), `${what} → ${want}`).toBe(want);
        }
      }
});

describe("World's desk pin for a core tab is its label", () => {
  const boardStore = (desk_pins: Record<string, unknown>) => {
    const patches: BoardOp[][] = [];
    return {
      patches,
      store: {
        get: () => ({ document: { layout: { desk_pins } } }),
        patch: async (ops: BoardOp[]) => {
          patches.push(ops);
          return null;
        },
      } as unknown as BoardDocumentStore,
    };
  };
  const target = (connectionId: string) => ({
    connectionId,
    workspaceId: "w1",
    tabId: "t1",
    workspaceIds: new Set(["w1"]),
  });

  test("pinning a core desk never saves a World-only pin; a Herdr desk still does", async () => {
    const stale: CorePins = corePinsOf([
      core([pane("t1", "a1", { agent: "claude" })], { stale: true }),
    ]);
    const { store, patches } = boardStore({});
    // A stale core refuses with a notice rather than writing World's pin.
    expect(await setDeskPinned(target("box-core"), true, store, stale)).toBe(
      false,
    );
    expect(patches).toEqual([]);
    await setDeskPinned(target("tui"), true, store, stale);
    expect(patches).toEqual([[{ op: "desk.pin", key: "tui:t1", cell: null }]]);
  });
});
