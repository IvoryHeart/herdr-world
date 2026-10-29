import { expect, test } from "bun:test";
import {
  deskSessionFingerprint,
  observeDeskPanes,
} from "../../../server/src/world/desk-observation";
import { WorldDeskRegistry } from "../../../server/src/world/desk-state";
import { WorldDeskStore } from "./deskStateStore";
import { deskIdentity, deskMetadata } from "./useDeskState";
import { partitionDesk } from "./DeskView";
import {
  pollingTargets,
  receiptStateOf,
  receiptTrigger,
  type TurnReceipt,
} from "./handoffs";
import type { WorldLeafObject } from "./worldObject";

const now = Date.UTC(2026, 0, 1, 12);
for (const observed of [false, true])
  for (const writer of ["narrow", "wide"]) {
    test(`${writer} browser shares a stop with different receipt coverage (observed: ${observed})`, async () => {
      const agents = Array.from(
        { length: 41 },
        (_, n) =>
          ({
            id: `agent-${n}`,
            terminalId: `terminal-${n}`,
            connectionId: n < 20 ? "alpha" : "beta",
            generation: 1,
            agentSessionFingerprint: "a".repeat(64),
            kind: "agent",
            status: "done",
            lastActivityAt: now - 1000,
          }) as WorldLeafObject,
      );
      // The fair 40-receipt limit admits twenty done agents from each host.
      // Beta's twenty-first agent is polled only under the narrow Hosts filter.
      const target = agents[40]!;
      const narrow = agents.filter((agent) => agent.connectionId === "beta"),
        wide = agents;
      expect(pollingTargets(narrow)).toContain(target);
      expect(pollingTargets(wide)).not.toContain(target);
      const registry = new WorldDeskRegistry();
      if (observed) {
        registry.observeAgent(deskIdentity(target), "working", now - 2000);
        registry.observeAgent(deskIdentity(target), "done", now - 1000);
      }
      const client = {
        call: async (method: string, params?: Record<string, unknown>) => {
          if (method === "world.desk.review")
            registry.mark(
              deskIdentity(target),
              String(params?.stop_id),
              params?.reviewed === true,
              now,
            );
          return registry.list();
        },
        onControl: () => () => {},
        onStatus: () => () => {},
      };
      const a = new WorldDeskStore(client),
        b = new WorldDeskStore(client);
      await Promise.all([a.refresh(), b.refresh()]);
      const receipt = {
        turn_id: "turn-7",
        ended_at: new Date(now - 1000).toISOString(),
      } as TurnReceipt;
      const card = (
        store: WorldDeskStore,
        visible: WorldLeafObject[],
        leaf = target,
      ) => {
        const state = store.get(),
          polled = pollingTargets(visible).includes(target);
        const { handled, stops, stopIds } = deskMetadata([leaf], state);
        return partitionDesk(
          [leaf],
          () =>
            receiptStateOf(
              { receipt, trigger: receiptTrigger(leaf) },
              leaf,
              polled,
            ),
          handled,
          now,
          stops,
          stopIds,
        ).review[0]!;
      };
      const first = writer === "narrow" ? card(a, narrow) : card(b, wide);
      expect(
        await (writer === "narrow" ? a : b).mutate(
          "world.desk.review",
          deskIdentity(target),
          {
            stop_id: JSON.parse(first.handoffId)[1],
            reviewed: true,
          },
        ),
      ).toBe(true);
      await Promise.all([a.refresh(), b.refresh()]);
      expect(card(a, narrow).handled).toBe(true);
      expect(card(b, wide).handled).toBe(true);
      expect(card(a, wide).handled).toBe(true);
      // A new native activity observation also distinguishes a subsequent turn
      // when the short working interval fell between service snapshot reads.
      const later = { ...target, lastActivityAt: now + 1 };
      expect(card(a, narrow, later).handled).toBe(false);
      expect(card(b, wide, later).handled).toBe(false);
      registry.observeAgent(deskIdentity(target), "working", now + 1000);
      registry.observeAgent(deskIdentity(target), "done", now + 2000);
      await Promise.all([a.refresh(), b.refresh()]);
      expect(card(a, narrow).handled).toBe(false);
      expect(card(b, wide).handled).toBe(false);
    });
  }

const nativeSession = {
  source: "reported",
  agent: "codex",
  kind: "id",
  value: "demo-session",
};
const nativePane = {
  pane_id: "w1:p1",
  terminal_id: "terminal-a",
  agent: "codex",
  agent_session: nativeSession,
  agent_status: "done",
};
const stoppedLeaf = {
  id: "leaf:alpha:w1:p1",
  terminalId: "terminal-a",
  connectionId: "alpha",
  generation: 1,
  agentSessionFingerprint: deskSessionFingerprint(nativeSession),
  kind: "agent",
  status: "done",
} as WorldLeafObject;
function projectedStop(registry: WorldDeskRegistry, at = now) {
  const metadata = deskMetadata([stoppedLeaf], {
    ...registry.list(),
    verified: true,
    error: null,
  });
  return partitionDesk(
    [stoppedLeaf],
    () => ({ receipt: null, current: true }),
    metadata.handled,
    at,
    metadata.stops,
    metadata.stopIds,
  ).review[0]!;
}
function reviewCurrent(registry: WorldDeskRegistry) {
  registry.mark(
    deskIdentity(stoppedLeaf),
    JSON.parse(projectedStop(registry).handoffId)[1],
    true,
    now,
  );
  expect(projectedStop(registry).handled).toBe(true);
}
function observeNative(
  registry: WorldDeskRegistry,
  status: string,
  at: number,
  seq?: number,
) {
  observeDeskPanes(
    registry,
    "alpha",
    1,
    [{ ...nativePane, agent_status: status }],
    at,
    [
      {
        ...nativePane,
        agent_status: status,
        ...(seq === undefined ? {} : { state_change_seq: seq }),
      },
    ],
  );
}

test("expiring a display timestamp keeps the unchanged done stop reviewed", () => {
  const registry = new WorldDeskRegistry();
  observeNative(registry, "working", now - 2000, 1);
  observeNative(registry, "done", now - 1000, 2);
  reviewCurrent(registry);
  const before = projectedStop(registry).handoffId;
  registry.expire(now + 13 * 60 * 60_000);
  expect(registry.list().records[0]!.stopped_at).toBeNull();
  expect(projectedStop(registry, now + 13 * 60 * 60_000).handled).toBe(true);
  expect(projectedStop(registry).handoffId).toBe(before);
});

test("native state progress detects a second completed turn without a working snapshot", () => {
  const registry = new WorldDeskRegistry();
  observeNative(registry, "done", now - 1000, 10);
  reviewCurrent(registry);
  observeNative(registry, "done", now + 1000, 12);
  expect(projectedStop(registry, now + 1000).handled).toBe(false);
});

test("native progress is retained with a reviewed record across observation expiry", () => {
  const registry = new WorldDeskRegistry();
  observeNative(registry, "working", now - 2000, 1);
  observeNative(registry, "done", now - 1000, 2);
  reviewCurrent(registry);
  const later = now + 13 * 60 * 60_000;
  registry.expire(later);
  observeNative(registry, "done", later, 4);
  expect(projectedStop(registry, later).handled).toBe(false);
});

test("a non-done to done transition also advances a stop when sequences are absent", () => {
  const registry = new WorldDeskRegistry();
  observeNative(registry, "working", now - 2000);
  observeNative(registry, "done", now - 1000);
  reviewCurrent(registry);
  observeNative(registry, "idle", now + 1000);
  observeNative(registry, "done", now + 2000);
  expect(projectedStop(registry, now + 2000).handled).toBe(false);
});

test("qualified agent.list metadata detects progress when pane.list omits agent fields", () => {
  const registry = new WorldDeskRegistry();
  const bare = {
    pane_id: nativePane.pane_id,
    terminal_id: nativePane.terminal_id,
  };
  observeDeskPanes(registry, "alpha", 1, [bare], now - 1000, [
    { ...nativePane, state_change_seq: 1 },
  ]);
  reviewCurrent(registry);
  observeDeskPanes(registry, "alpha", 1, [bare], now + 1000, [
    { ...nativePane, state_change_seq: 3 },
  ]);
  expect(projectedStop(registry, now + 1000).handled).toBe(false);
});

test("equal or obsolete native progress does not retire a mark after display expiry", () => {
  const registry = new WorldDeskRegistry();
  observeNative(registry, "working", now - 2000, 1);
  observeNative(registry, "done", now - 1000, 2);
  reviewCurrent(registry);
  const before = projectedStop(registry).handoffId;
  const later = now + 13 * 60 * 60_000;
  registry.expire(later);
  observeNative(registry, "done", later, 2);
  observeNative(registry, "done", later + 1, 1);
  expect(projectedStop(registry, later).handled).toBe(true);
  expect(projectedStop(registry).handoffId).toBe(before);
  observeNative(registry, "done", later + 2, 4);
  expect(projectedStop(registry, later + 2).handled).toBe(false);
});

test("a reviewed idle stop stays in Reviewed when only its display time expires", () => {
  const registry = new WorldDeskRegistry();
  registry.observeAgent(deskIdentity(stoppedLeaf), "working", now - 2000, 1);
  registry.observeAgent(deskIdentity(stoppedLeaf), "idle", now - 1000, 2);
  const idle = { ...stoppedLeaf, status: "idle" } as WorldLeafObject;
  const project = (at: number) => {
    const metadata = deskMetadata([idle], {
      ...registry.list(),
      verified: true,
      error: null,
    });
    return partitionDesk(
      [idle],
      () => ({ receipt: null, current: true }),
      metadata.handled,
      at,
      metadata.stops,
      metadata.stopIds,
    ).review;
  };
  registry.mark(
    deskIdentity(idle),
    JSON.parse(project(now)[0]!.handoffId)[1],
    true,
    now,
  );
  registry.expire(now + 13 * 60 * 60_000);
  expect(project(now + 13 * 60 * 60_000)[0]?.handled).toBe(true);
});

for (const row of [
  [{ ...nativePane, terminal_id: "replacement-terminal", state_change_seq: 9 }],
  [
    {
      ...nativePane,
      agent_session: { ...nativeSession, value: "other-session" },
      state_change_seq: 9,
    },
  ],
  [
    { ...nativePane, state_change_seq: 9 },
    { ...nativePane, state_change_seq: 10 },
  ],
  [{ ...nativePane, state_change_seq: -1 }],
  [{ ...nativePane, state_change_seq: "9" }],
])
  test("unqualified or malformed agent progress cannot invalidate a reviewed stop", () => {
    const registry = new WorldDeskRegistry();
    observeNative(registry, "working", now - 2000, 1);
    observeNative(registry, "done", now - 1000, 2);
    reviewCurrent(registry);
    const before = projectedStop(registry).handoffId;
    observeDeskPanes(registry, "alpha", 1, [nativePane], now + 1000, row);
    expect(projectedStop(registry).handled).toBe(true);
    expect(projectedStop(registry).handoffId).toBe(before);
  });
