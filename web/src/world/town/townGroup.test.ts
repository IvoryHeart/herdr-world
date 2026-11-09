import { expect, test } from "bun:test";
import {
  townBoxKeys,
  townGroupAdd,
  townGroupCounts,
  townGroupCountsText,
  townGroupFrame,
  townGroupOrders,
  townGroupPrune,
  townGroupRooms,
  townGroupState,
  townGroupToggle,
  townMessageLeftOut,
  townOrderCount,
  townOrderReport,
  townSendOutcomeText,
  type TownGroupMember,
  type TownSendOutcome,
} from "./townGroup";
import { townReviewAll, townSendAll, townSendOne } from "./townGroupSend";
import { TownBoxSelect, townHitAgents } from "./townGroupCanvas";
import type { TownModel } from "./townModel";
import type { TownHit } from "./townHitTest";
import { TownScaleRuntime } from "./townScaleRuntime";

type Status = "working" | "blocked" | "done" | "idle" | "unknown";
const agent = (
  key: string,
  semanticStatus: Status,
  extra: {
    usageStop?: object;
    stale?: boolean;
    canOpenInSpaces?: boolean;
  } = {},
) => ({
  key,
  semanticStatus,
  stale: false,
  canOpenInSpaces: true,
  ...extra,
  usageStop: extra.usageStop as never,
});
const chatLeaf = { kind: "agent", capabilities: { agentHistory: true } };

test("each chosen agent's state is the board's: finished, working, needs you, idle", () => {
  expect(townGroupState(agent("a", "done"), true)).toBe("finished");
  // Finished work is Town's finished call, even for an idle agent.
  expect(townGroupState(agent("a", "idle"), true)).toBe("finished");
  expect(townGroupState(agent("a", "done"), false)).toBe("idle");
  expect(townGroupState(agent("a", "working"), false)).toBe("working");
  expect(townGroupState(agent("a", "blocked"), false)).toBe("needsYou");
  expect(townGroupState(agent("a", "idle", { usageStop: {} }), false)).toBe(
    "outOfFuel",
  );
  expect(townGroupState(agent("a", "unknown"), false)).toBe("unknown");
});

test("the sign's counts name only the states present, in the board's order", () => {
  const counts = townGroupCounts([
    "finished",
    "working",
    "finished",
    "needsYou",
    "idle",
    "working",
    "finished",
  ]);
  expect(townGroupCountsText(counts)).toBe(
    "7 selected · 3 finished · 2 working · 1 needs you · 1 idle",
  );
  expect(townGroupCountsText(townGroupCounts(["outOfFuel"]))).toBe(
    "1 selected · 1 out of fuel",
  );
});

test("toggle, add and prune keep the selection model's rules", () => {
  const none: ReadonlySet<string> = new Set();
  const one = townGroupToggle(none, ["a"]);
  expect([...one]).toEqual(["a"]);
  // A table's agents join together, and leave together once all are in.
  const desk = townGroupToggle(one, ["a", "b"]);
  expect([...desk].sort()).toEqual(["a", "b"]);
  expect(townGroupToggle(desk, ["a", "b"]).size).toBe(0);
  expect(townGroupToggle(desk, [])).toBe(desk);
  // A box adds; the same set when nothing is new.
  expect(townGroupAdd(desk, ["a"])).toBe(desk);
  expect([...townGroupAdd(desk, ["c"])].sort()).toEqual(["a", "b", "c"]);
  // Agents that left the map (closed or binned) leave the selection.
  expect(townGroupPrune(desk, () => true)).toBe(desk);
  expect([...townGroupPrune(desk, (key) => key !== "b")]).toEqual(["a"]);
  expect(townGroupPrune(desk, () => false).size).toBe(0);
});

test("a box takes the agents whose drawn bodies it touches, wherever they stand", () => {
  const at: Record<string, { x: number; y: number } | null> = {
    desk: { x: 10, y: 10 },
    reception: { x: 40, y: 5 },
    bar: { x: 90, y: 90 },
    // Seated: its feet are below the box, its body reaches into it.
    seated: { x: 30, y: 60 },
    folded: null,
  };
  expect(
    townBoxKeys(
      { x0: 50, y0: 0, x1: 0, y1: 20 },
      Object.keys(at),
      (key) => at[key]!,
    ),
  ).toEqual(["desk", "reception", "seated"]);
  expect(townGroupFrame([])).toBeNull();
  expect(
    townGroupFrame(
      [
        { x: 0, y: 0 },
        { x: 100, y: 50 },
      ],
      10,
    ),
  ).toEqual({
    x: -10,
    y: -10,
    width: 120,
    height: 70,
  });
});

test("a message leaves out agents with a question, shells, out-of-fuel and offline agents", () => {
  expect(townMessageLeftOut(agent("a", "idle"), chatLeaf)).toBeNull();
  expect(townMessageLeftOut(agent("a", "working"), chatLeaf)).toBeNull();
  expect(townMessageLeftOut(agent("a", "done"), chatLeaf)).toBeNull();
  expect(townMessageLeftOut(agent("a", "blocked"), chatLeaf)).toBe(
    "has a question",
  );
  expect(townMessageLeftOut(agent("a", "idle"), { kind: "terminal" })).toBe(
    "plain shell",
  );
  expect(townMessageLeftOut(agent("a", "idle"), null)).toBe("plain shell");
  expect(
    townMessageLeftOut(agent("a", "idle", { usageStop: {} }), chatLeaf),
  ).toBe("out of fuel");
  expect(
    townMessageLeftOut(agent("a", "idle", { stale: true }), chatLeaf),
  ).toBe("offline");
  expect(
    townMessageLeftOut(agent("a", "idle"), {
      kind: "agent",
      capabilities: { agentHistory: false },
    }),
  ).toBe("offline");
});

test("each order's label counts exactly the agents it acts on", () => {
  const members: TownGroupMember[] = [
    { key: "a", label: "A", state: "finished", leftOut: null },
    { key: "b", label: "B", state: "working", leftOut: null },
    { key: "c", label: "C", state: "needsYou", leftOut: "has a question" },
    { key: "d", label: "D", state: "idle", leftOut: "out of fuel" },
  ];
  const orders = townGroupOrders(members);
  expect(orders.review.map((m) => m.key)).toEqual(["a"]);
  expect(orders.message.map((m) => m.key)).toEqual(["a", "b"]);
  expect(orders.leftOut.map((m) => m.key)).toEqual(["c", "d"]);
  expect(`Send a message ${townOrderCount(2, 4)}`).toBe(
    "Send a message (2 of 4)",
  );
  expect(`Mark reviewed ${townOrderCount(3, 3)}`).toBe("Mark reviewed (3)");
});

/** A host that answers Chat's calls as given; records what it was asked. */
function host(
  latest: Record<string, unknown> | Error,
  send: Record<string, unknown> | Error = { status: "sent", delivery: {} },
) {
  const calls: [string, Record<string, unknown> | undefined][] = [];
  return {
    calls,
    client: {
      isCurrent: () => true,
      call: async (method: string, params?: Record<string, unknown>) => {
        calls.push([method, params]);
        const reply = method === "agent_conversation.latest" ? latest : send;
        if (reply instanceof Error) throw reply;
        return reply;
      },
    },
  };
}
const ok = { status: "ok", session_fingerprint: "s1", pending_prompt: null };

test("a send goes through Chat's path and reports sent, queued or refused, never success it did not get", async () => {
  const idle = host(ok);
  expect(await townSendOne(idle.client, "p1", "say hi")).toEqual({
    status: "sent",
  });
  expect(idle.calls).toEqual([
    ["agent_conversation.latest", { pane_id: "p1", menus: true }],
    [
      "agent_conversation.send",
      { pane_id: "p1", text: "say hi", session_fingerprint: "s1" },
    ],
  ]);
  const busy = host(ok, { status: "sent", delivery: { queued: true } });
  expect(await townSendOne(busy.client, "p1", "hi")).toEqual({
    status: "queued",
  });
  const refused = host(ok, {
    status: "refused",
    reason: "changed",
    message: "The conversation in this pane changed. Nothing was sent.",
  });
  expect(await townSendOne(refused.client, "p1", "hi")).toEqual({
    status: "refused",
    reason: "The conversation in this pane changed. Nothing was sent.",
  });
  // A question that appeared since the selection: nothing is sent.
  const asking = host({ ...ok, pending_prompt: { question: ["Allow?"] } });
  const outcome = await townSendOne(asking.client, "p1", "hi");
  expect(outcome.status).toBe("refused");
  expect(asking.calls.map(([method]) => method)).toEqual([
    "agent_conversation.latest",
  ]);
  const unbound = host({ status: "ok", session_fingerprint: null });
  expect((await townSendOne(unbound.client, "p1", "hi")).status).toBe(
    "refused",
  );
  const failing = host(ok, new Error("Herdr did not confirm the prompt."));
  expect(await townSendOne(failing.client, "p1", "hi")).toEqual({
    status: "refused",
    reason: "Herdr did not confirm the prompt. Nothing was sent.",
  });
  expect((await townSendOne(null, "p1", "hi")).status).toBe("refused");
});

test("group sends report each agent as it arrives; reviews go one at a time", async () => {
  const seen: [string, string][] = [];
  let release!: () => void;
  const slow = new Promise<void>((resolve) => (release = resolve));
  const done = townSendAll(
    [{ key: "a" }, { key: "b" }],
    async ({ key }): Promise<TownSendOutcome> => {
      if (key === "a") await slow;
      return { status: key === "a" ? "queued" : "sent" };
    },
    (key, outcome) => seen.push([key, townSendOutcomeText(outcome)]),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(seen).toEqual([
    ["a", "sending…"],
    ["b", "sending…"],
    ["b", "sent"],
  ]);
  release();
  await done;
  expect(seen[seen.length - 1]).toEqual([
    "a",
    "queued: it is busy and reads it next",
  ]);

  const order: string[] = [];
  const outcomes: [string, string][] = [];
  await townReviewAll(
    [{ key: "a" }, { key: "b" }, { key: "c" }],
    async ({ key }) => {
      order.push(key);
      if (key === "c") throw new Error("offline");
      return key === "a";
    },
    (key, outcome) => outcomes.push([key, outcome]),
  );
  expect(order).toEqual(["a", "b", "c"]);
  expect(outcomes.slice(3)).toEqual([
    ["a", "reviewed"],
    ["b", "not saved"],
    ["c", "not saved"],
  ]);
});

const model = {
  agents: new Map([
    ["agent-1", {}],
    ["agent-2", {}],
    ["agent-3", {}],
  ]),
  devices: new Map([["pane-2", { agentKey: "agent-2" }]]),
  desks: new Map([
    [
      "desk-1",
      { paneDevices: [{ agentKey: "agent-1" }, {}, { agentKey: "agent-3" }] },
    ],
  ]),
} as unknown as TownModel;

test("Shift+click toggles the agent under it, or a table's agents", () => {
  expect(townHitAgents({ kind: "agent", key: "agent-1" }, model)).toEqual([
    "agent-1",
  ]);
  expect(
    townHitAgents({ kind: "pane", key: "pane-2", deskKey: "desk-1" }, model),
  ).toEqual(["agent-2"]);
  expect(townHitAgents({ kind: "desk", key: "desk-1" }, model)).toEqual([
    "agent-1",
    "agent-3",
  ]);
  expect(townHitAgents({ kind: "center" }, model)).toEqual([]);
  expect(townHitAgents(null, model)).toEqual([]);
});

test("only a Shift press with the mouse draws a box; it adds what it covers", () => {
  const added: string[][] = [];
  const toggled: string[][] = [];
  const drawn: unknown[] = [];
  const positions: Record<string, { x: number; y: number }> = {
    "agent-1": { x: 15, y: 15 },
    "agent-2": { x: 80, y: 80 },
    "agent-3": { x: 25, y: 5 },
  };
  const box = new TownBoxSelect({
    // The world is drawn at twice the screen's scale here.
    toWorld: (at) => ({ x: at.x / 2, y: at.y / 2 }),
    model: () => model,
    position: (key) => positions[key] ?? null,
    draw: (rect) => drawn.push(rect),
    add: (keys) => added.push([...keys]),
    toggle: (keys) => toggled.push([...keys]),
    keys: () => new Set(),
    selecting: () => false,
  });
  const hit = {
    hitAt: (): TownHit | null => ({ kind: "agent", key: "agent-2" }),
  };
  const press = (extra: object) => ({
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    shiftKey: true,
    ...extra,
  });
  // Plain presses, touch and other buttons are the town's: pan, open, hold.
  expect(box.down(press({ shiftKey: false }), { x: 0, y: 0 }, hit)).toBe(false);
  expect(box.down(press({ pointerType: "touch" }), { x: 0, y: 0 }, hit)).toBe(
    false,
  );
  expect(box.down(press({ button: 2 }), { x: 0, y: 0 }, hit)).toBe(false);
  expect(box.move(1, { x: 5, y: 5 })).toBe(false);

  expect(box.down(press({}), { x: 0, y: 0 }, hit)).toBe(true);
  expect(box.move(2, { x: 9, y: 9 })).toBe(false);
  expect(box.move(1, { x: 60, y: 40 })).toBe(true);
  expect(drawn[drawn.length - 1]).toEqual({
    x: 0,
    y: 0,
    width: 60,
    height: 40,
  });
  expect(box.up(1, { x: 60, y: 40 }, false)).toBe(true);
  expect(drawn[drawn.length - 1]).toBeNull();
  expect(added).toEqual([["agent-1", "agent-3"]]);

  // A press that barely moves is Shift+click: it toggles what is under it.
  expect(box.down(press({}), { x: 100, y: 100 }, hit)).toBe(true);
  expect(box.up(1, { x: 102, y: 101 }, false)).toBe(true);
  expect(toggled).toEqual([["agent-2"]]);

  // A cancelled press does nothing.
  box.down(press({}), { x: 0, y: 0 }, hit);
  box.move(1, { x: 60, y: 40 });
  expect(box.up(1, { x: 60, y: 40 }, true)).toBe(true);
  expect(added).toHaveLength(1);
});

test("the scale scene's hosts take a group message with synthetic outcomes", async () => {
  let now = 1_000_000_000;
  const scene = new TownScaleRuntime(() => now, 5);
  const panes = scene
    .get()
    .flatMap((h) =>
      h.snapshot!.panes.map((pane) => ({ host: h.connectionId, pane })),
    );
  const first = (status: string) =>
    panes.find(({ pane }) => pane.agent && pane.agent_status === status)!;
  const send = (entry: ReturnType<typeof first>) =>
    townSendOne(scene.client(entry.host), entry.pane.pane_id, "say hi");
  expect(await send(first("working"))).toEqual({ status: "queued" });
  const idle = first("idle");
  expect(await send(idle)).toEqual({ status: "sent" });
  // The idle agent takes the message and works on it.
  expect(
    scene
      .get()
      .flatMap((h) => h.snapshot!.panes)
      .find((pane) => pane.pane_id === idle.pane.pane_id)?.agent_status,
  ).toBe("working");
  const unknown = await send(first("unknown"));
  expect(unknown.status).toBe("refused");
  expect(unknown.status === "refused" ? unknown.reason : "").toContain(
    "(test data)",
  );
  now += 10;
  await new Promise((resolve) => setTimeout(resolve, 20));
});

test("zoomed out, each room card counts its chosen agents", () => {
  const agents = new Map([
    ["a", { roomKey: "r1" }],
    ["b", { roomKey: "r1" }],
    ["c", { roomKey: "r2" }],
  ]);
  expect([...townGroupRooms(new Set(["a", "b", "c", "gone"]), agents)]).toEqual(
    [
      ["r1", 2],
      ["r2", 1],
    ],
  );
  expect(townGroupRooms(undefined, agents).size).toBe(0);
});

test("an overlapping order's late outcome never overwrites the newer order's row", () => {
  type Rows =
    | readonly { key: string; label: string; outcome: TownSendOutcome }[]
    | null;
  let rows: Rows = null;
  const set = (update: (rows: Rows) => Rows) => {
    rows = update(rows);
  };
  const order = { id: 0 };
  const first = townOrderReport<TownSendOutcome>(order, set);
  rows = [{ key: "a", label: "A", outcome: { status: "sending" } }];
  const second = townOrderReport<TownSendOutcome>(order, set);
  rows = [{ key: "a", label: "A", outcome: { status: "sending" } }];
  second("a", {
    status: "refused",
    reason: "it has a question; nothing was sent",
  });
  first("a", { status: "sent" });
  expect(rows).toEqual([
    {
      key: "a",
      label: "A",
      outcome: {
        status: "refused",
        reason: "it has a question; nothing was sent",
      },
    },
  ]);
  // Clear retires the running order too.
  order.id++;
  second("a", { status: "sent" });
  expect(rows?.[0]?.outcome.status).toBe("refused");
});
