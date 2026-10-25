import { expect, test } from "bun:test";
import type { Pane, Tab, Workspace } from "../../types";
import {
  projectWorldOffice,
  prepareWorldOffice,
  createOfficeProjector,
  TOWN_PRESENTATION_BOUNDS,
} from "../herdrOfficeProjection";
import type { OfficeAgent } from "../herdrOfficeProjection";
import type { OfficeObservability } from "../officeObservability";
import type { WorldRuntimeConnection } from "../runtimeStore";
import { buildWorldObject, worldObjectForHosts } from "../worldObject";
import { officeReadModel } from "../officeReadModel";
import { withTownFinished } from "./townFinished";
import { townFoldedActivity } from "./townFoldedActivity";
import { townCalls, type TownCall } from "./TownRail";
import type { WorldAsk } from "../worldAsks";
import { townSummary, townSummaryAge } from "./townSummary";

/** One synthetic host: two rooms, one agent per tab, with given statuses. */
function office(statuses: Record<string, string[]>) {
  const workspaces: Workspace[] = Object.keys(statuses).map((id, index) => ({
    workspace_id: id,
    number: index + 1,
    label: id,
    focused: index === 0,
    pane_count: statuses[id]!.length,
    tab_count: statuses[id]!.length,
    active_tab_id: `${id}:t0`,
    agent_status: "working",
  }));
  const tabs: Tab[] = [];
  const panes: Pane[] = [];
  for (const [id, list] of Object.entries(statuses))
    list.forEach((status, index) => {
      const tabId = `${id}:t${index}`;
      tabs.push({
        tab_id: tabId,
        workspace_id: id,
        number: index + 1,
        label: `Tab ${index + 1}`,
        focused: index === 0,
        pane_count: 1,
        agent_status: status,
      });
      panes.push({
        pane_id: `${tabId}:p`,
        terminal_id: `term-${tabId}`,
        workspace_id: id,
        tab_id: tabId,
        focused: true,
        agent: "claude",
        agent_status: status,
        last_activity_at: 1_000 * (index + 1),
        revision: 1,
      });
    });
  const connection: WorldRuntimeConnection = {
    connectionId: "studio",
    label: "studio",
    source: "saved-profile",
    isDefault: true,
    state: "ready",
    generation: 1,
    snapshotGeneration: 1,
    stale: false,
    actionable: true,
    snapshot: { workspaces, tabs, panes, agents: [] },
  };
  const world = buildWorldObject([connection], "studio");
  const projection = projectWorldOffice(
    world,
    1,
    null,
    TOWN_PRESENTATION_BOUNDS,
  );
  /** Herdr's activity time, read from the World leaf as Town does. */
  const activityOf = (agent: OfficeAgent) => {
    const leaf = world.nodeById.get(agent.nodeId);
    return leaf && "lastActivityAt" in leaf ? leaf.lastActivityAt : undefined;
  };
  return Object.assign(projection, { activityOf, world, connection });
}

test("Summary reads prepared room totals without rescanning agents for asks or spend", async () => {
  const { world } = office({ alpha: ["working", "blocked"], beta: ["idle"] });
  await prepareWorldOffice(world);
  const projection = projectWorldOffice(
    world,
    1,
    null,
    TOWN_PRESENTATION_BOUNDS,
  );
  projection.roster = new Proxy(projection.roster, {
    get(target, key, receiver) {
      if (key === Symbol.iterator) throw Error("unnecessary agent recount");
      return Reflect.get(target, key, receiver);
    },
  });
  const first = townSummary(projection, [], NO_METRICS);
  expect(first.counts.working).toBe(1);
  expect(first.hosts[0]!.counts.needsYou).toBe(1);
  expect(first.hosts[0]!.counts.quiet).toBe(1);
  const refreshed = townSummary(projection, [], {
    ...NO_METRICS,
    observedAt: 9,
  });
  expect(refreshed.hosts).toBe(first.hosts);
});

test("Summary reuses unchanged room contributions and removes closed rooms on refresh", async () => {
  const initial = office({ alpha: ["idle"], beta: ["working"] });
  await prepareWorldOffice(initial.world);
  const project = createOfficeProjector(TOWN_PRESENTATION_BOUNDS);
  const firstOffice = project(initial.world, 1, null);
  const first = townSummary(firstOffice, [], NO_METRICS);
  const unchanged = townSummary(
    project(initial.world, 2, null),
    [],
    NO_METRICS,
  );
  expect(unchanged.hosts[0]!.rooms.map((room) => room.counts)).toEqual(
    first.hosts[0]!.rooms.map((room) => room.counts),
  );
  expect(unchanged.hosts[0]!.rooms[1]!.counts).toBe(
    first.hosts[0]!.rooms[1]!.counts,
  );

  const changed = office({ alpha: ["blocked"], beta: ["working"] });
  const host = {
    ...changed.world.hosts[0]!,
    label: "Renamed studio",
    stale: true,
    spaces: [changed.world.spaces[0]!, initial.world.spaces[1]!],
  };
  const world = worldObjectForHosts({ ...changed.world, hosts: [host] }, [
    "studio",
  ]);
  await prepareWorldOffice(world);
  const second = townSummary(project(world, 3, null), [], NO_METRICS);
  expect(second.hosts[0]!.label).toBe("Renamed studio");
  expect(second.hosts[0]!.stale).toBe(true);
  expect(second.hosts[0]!.counts).toEqual({
    needsYou: 1,
    working: 1,
    finished: 0,
    quiet: 0,
    unknown: 0,
  });
  expect(second.hosts[0]!.rooms[1]!.counts).toBe(
    first.hosts[0]!.rooms[1]!.counts,
  );

  const removed = office({ alpha: ["blocked"] });
  await prepareWorldOffice(removed.world);
  const last = townSummary(project(removed.world, 4, null), [], NO_METRICS);
  expect(last.hosts[0]!.rooms.map((room) => room.label)).toEqual(["alpha"]);
  expect(last.hosts[0]!.counts.working).toBe(0);
  expect(last.hosts[0]!.counts.needsYou).toBe(1);
});

test("finish and seen deltas update prepared Summary totals without changing the raw snapshot", async () => {
  const { world } = office({ alpha: ["idle", "done"], beta: ["working"] });
  await prepareWorldOffice(world);
  const base = projectWorldOffice(world, 1, null, TOWN_PRESENTATION_BOUNDS);
  const idle = base.roster.find(
    ({ agent }) => agent.semanticStatus === "idle",
  )!.agent;
  const done = base.roster.find(
    ({ agent }) => agent.semanticStatus === "done",
  )!.agent;
  const finished = withTownFinished(base, new Set([idle.key]), new Set());
  const reviewed = withTownFinished(base, new Set(), new Set([done.key]));
  expect(townSummary(finished, [], NO_METRICS).hosts[0]!.counts.finished).toBe(
    2,
  );
  expect(townSummary(reviewed, [], NO_METRICS).hosts[0]!.counts.finished).toBe(
    0,
  );
  expect(townSummary(base, [], NO_METRICS).hosts[0]!.counts.finished).toBe(1);
  expect(officeReadModel(finished).agentOf(idle.key)?.semanticStatus).toBe(
    "done",
  );
  expect(
    officeReadModel(finished).agentForPane(
      idle.currentPaneRef.connectionId,
      idle.currentPaneRef.nativeId,
    )?.semanticStatus,
  ).toBe("done");
  expect(officeReadModel(finished).roomCounts.get(base.rooms[1]!.key)).toBe(
    officeReadModel(base).roomCounts.get(base.rooms[1]!.key),
  );
});

test("verified asks use snapshot-qualified indexes across host collisions and generation turnover", async () => {
  const { connection } = office({ alpha: ["idle"] });
  const world = buildWorldObject([
    connection,
    { ...connection, connectionId: "other" },
  ]);
  await prepareWorldOffice(world);
  const project = createOfficeProjector(TOWN_PRESENTATION_BOUNDS);
  const base = project(world, 1, null);
  const agent = base.roster.find(
    ({ agent }) => agent.currentPaneRef.connectionId === "other",
  )!.agent;
  const ask: WorldAsk = {
    id: "qualified",
    at: 1,
    question: "Continue?",
    options: [],
    owner_only: true,
    actor: {
      label: "Synthetic asker",
      verified: true,
      connection_id: "other",
      pane_id: agent.currentPaneRef.nativeId,
      terminal_id: agent.currentTerminalRef.nativeId,
    },
  };
  const cached = project(world, 2, null);
  cached.roster = new Proxy(cached.roster, {
    get(target, key, receiver) {
      if (key === Symbol.iterator) throw Error("ask scanned the roster");
      return Reflect.get(target, key, receiver);
    },
  });
  const withAsk = townSummary(cached, [], NO_METRICS, undefined, [ask]);
  expect(withAsk.counts.needsYou).toBe(1);
  expect(townSummary(cached, [], NO_METRICS).hosts).toBe(withAsk.hosts);
  expect(townSummary(cached, [], NO_METRICS).counts.needsYou).toBe(0);

  const replacement = buildWorldObject([
    {
      ...connection,
      connectionId: "other",
      generation: 2,
      snapshotGeneration: 2,
      snapshot: {
        ...connection.snapshot!,
        panes: connection.snapshot!.panes.map((pane) => ({
          ...pane,
          terminal_id: "replacement-terminal",
          agent_status: "working",
        })),
      },
    },
  ]);
  await prepareWorldOffice(replacement);
  const current = project(replacement, 3, null);
  const lookup = officeReadModel(current).agentForPane;
  expect(
    lookup("other", agent.currentPaneRef.nativeId)?.observedGeneration,
  ).toBe(2);
  expect(lookup("studio", agent.currentPaneRef.nativeId)).toBeUndefined();
  expect(townSummary(current, [], NO_METRICS).counts.working).toBe(1);
});

function boundedWorld(agentStatus: "blocked" | "idle") {
  const { connection } = office({ alpha: Array<string>(16).fill(agentStatus) });
  const status = { working: 0, blocked: 0, idle: 0, done: 0, unknown: 0 };
  status[agentStatus] = 18;
  connection.snapshot!.coverage = {
    workspaces: 1,
    tabs: 18,
    panes: 18,
    agentPanes: 18,
    status,
    byWorkspace: [
      { workspaceId: "alpha", tabs: 18, panes: 18, agentPanes: 18, status },
    ],
  };
  return buildWorldObject([connection], "studio");
}

test("bounded aggregate coverage never adds Summary needs-you items absent from the rail roster", async () => {
  const world = boundedWorld("blocked");
  await prepareWorldOffice(world);
  const projection = projectWorldOffice(
    world,
    1,
    null,
    TOWN_PRESENTATION_BOUNDS,
  );
  const calls = townCalls(projection.roster, new Map(), [], (key) =>
    projection.roster.find(({ agent }) => agent.key === key),
  );
  const summary = townSummary(projection, calls, NO_METRICS);
  expect(projection.coverage.status.blocked).toBe(18);
  expect(projection.roster).toHaveLength(16);
  expect(calls).toHaveLength(16);
  expect(summary.counts.needsYou).toBe(16);
  expect(summary.hosts[0]!.counts.needsYou).toBe(summary.counts.needsYou);
  expect(summary.hosts[0]!.rooms[0]!.counts.needsYou).toBe(
    summary.counts.needsYou,
  );
});

test("bounded prepared totals retain exact finish and seen deltas on observed agents", async () => {
  const world = boundedWorld("idle");
  await prepareWorldOffice(world);
  const base = projectWorldOffice(world, 1, null, TOWN_PRESENTATION_BOUNDS);
  const [first, second] = base.roster.map(({ agent }) => agent.key);
  const finished = withTownFinished(
    base,
    new Set([first!, second!]),
    new Set(),
  );
  const reviewed = withTownFinished(
    base,
    new Set([second!]),
    new Set([first!]),
  );
  expect(townSummary(finished, [], NO_METRICS).hosts[0]!.counts).toMatchObject({
    finished: 2,
    quiet: 14,
  });
  expect(townSummary(reviewed, [], NO_METRICS).hosts[0]!.counts).toMatchObject({
    finished: 1,
    quiet: 15,
  });
  expect(townSummary(base, [], NO_METRICS).hosts[0]!.counts.quiet).toBe(16);
  expect(base.coverage.status.idle).toBe(18);
});

test("a verified Ask marks its hidden desk during a cached-generation reconnect without changing tab order", async () => {
  const { connection } = office({ alpha: Array<string>(30).fill("idle") });
  const world = buildWorldObject(
    [
      {
        ...connection,
        generation: 2,
        snapshotGeneration: 1,
        stale: true,
        actionable: false,
      },
    ],
    "studio",
  );
  await prepareWorldOffice(world);
  const project = createOfficeProjector(TOWN_PRESENTATION_BOUNDS);
  const pins = new Set<string>();
  const expanded = new Set<string>();
  const baseline = project(world, 1, null, pins, expanded);
  const visibleDesks = new Set(
    baseline.rooms.flatMap((room) => room.desks.map((desk) => desk.key)),
  );
  const agent = baseline.roster.find(
    ({ agent }) => agent.deskKey && !visibleDesks.has(agent.deskKey),
  )!.agent;
  expect(
    baseline.rooms[0]!.desks.some((desk) => desk.key === agent.deskKey),
  ).toBe(false);
  const ask: WorldAsk = {
    id: "cached",
    at: 1,
    question: "Continue?",
    options: [],
    owner_only: true,
    actor: {
      label: "Synthetic asker",
      verified: true,
      connection_id: "studio",
      pane_id: agent.currentPaneRef.nativeId,
      terminal_id: agent.currentTerminalRef.nativeId,
    },
  };
  const foldedOffice = project(world, 2, null, pins, expanded);
  expect(
    foldedOffice.rooms[0]!.desks.some((desk) => desk.key === agent.deskKey),
  ).toBe(false);
  foldedOffice.roster = new Proxy(foldedOffice.roster, {
    get(target, key, receiver) {
      if (key === Symbol.iterator)
        throw Error("hidden Ask indicator scanned the roster");
      return Reflect.get(target, key, receiver);
    },
  });
  expect(
    townFoldedActivity(foldedOffice, [], [ask]).get(agent.roomKey),
  ).toEqual({ needsYou: true, done: false });
  expect(townFoldedActivity(foldedOffice, [], []).size).toBe(0);
  expect(
    officeReadModel(foldedOffice).agentForPane(
      "studio",
      agent.currentPaneRef.nativeId,
    )?.observedGeneration,
  ).toBe(1);
  const mismatched = {
    ...ask,
    actor: { ...ask.actor, terminal_id: "another-terminal" },
  };
  expect(townFoldedActivity(foldedOffice, [], [mismatched]).size).toBe(0);
  expect(
    project(world, 3, null, pins, expanded).rooms[0]!.desks.some(
      (desk) => desk.key === agent.deskKey,
    ),
  ).toBe(false);
});

const NO_METRICS: OfficeObservability = {
  health: "unavailable",
  providerId: null,
  sourceCount: 0,
  configuredSourceCount: 0,
  failedSourceCount: 0,
  observedAt: 0,
  windowSeconds: null,
  models: [],
  totalCostUsd: null,
  totalUsage: 0,
};

/** The call rail's calls for an office: blocked agents and finished ones. */
function callsOf(projection: ReturnType<typeof office>): TownCall[] {
  return projection.roster.flatMap((entry): TownCall[] =>
    entry.agent.semanticStatus === "blocked" ||
    entry.agent.semanticStatus === "done"
      ? [
          {
            agent: entry.agent,
            kind: entry.agent.semanticStatus === "blocked" ? "blocked" : "done",
            since: 500,
            hostKey: entry.hostKey,
            hostLabel: entry.hostLabel,
            roomKey: entry.roomKey,
            roomLabel: entry.roomLabel,
          },
        ]
      : [],
  );
}

test("the summary counts what the call rail shows, room by room", () => {
  const projection = office({
    alpha: ["blocked", "working", "done"],
    beta: ["working", "idle"],
  });
  const summary = townSummary(
    projection,
    callsOf(projection),
    NO_METRICS,
    projection.activityOf,
  );
  // One shared needs-you count: the rail's blocked calls, which reception
  // also shows, and which the sign, the chip and the window all read.
  expect(summary.counts).toEqual({ needsYou: 1, working: 2, finished: 1 });
  const atReception = projection.receptions
    .flatMap((reception) => reception.waitingAgents)
    .filter((agent) => agent.semanticStatus === "blocked").length;
  expect(summary.counts.needsYou).toBe(atReception);
  expect(summary.needsYou.length).toBe(summary.counts.needsYou);
  expect(summary.needsYou.map((item) => item.roomLabel)).toEqual(["alpha"]);
  expect(summary.needsYou[0]!.since).toBe(500);
  // A finish carries Herdr's activity time, so it can show its age.
  expect(summary.finished[0]!.since).toBe(3_000);
  const [host] = summary.hosts;
  expect(host!.rooms.map((room) => [room.label, room.counts])).toEqual([
    ["alpha", { needsYou: 1, working: 1, finished: 1, quiet: 0, unknown: 0 }],
    ["beta", { needsYou: 0, working: 1, finished: 0, quiet: 1, unknown: 0 }],
  ]);
  expect(host!.counts.working).toBe(2);
});

test("open asks and blocked agents are separate needs-you items", () => {
  const projection = office({ alpha: ["blocked", "working"] });
  const calls = callsOf(projection);
  const asks: WorldAsk[] = [
    {
      id: "question-one",
      at: 500,
      actor: { label: calls[0]!.agent.displayLabel, verified: true },
      question: "Ship the synthetic change?",
      options: ["Ship", "Wait"],
      owner_only: true,
    },
    {
      id: "question-two",
      at: 600,
      actor: { label: "Synthetic reviewer", verified: false },
      question: "Review the example?",
      options: [],
      owner_only: true,
    },
  ];
  const summary = townSummary(
    projection,
    calls,
    NO_METRICS,
    projection.activityOf,
    asks,
  );
  // One blocked agent that also asks a question contributes two items.
  expect(summary.counts.needsYou).toBe(3);
  expect(summary.asks).toBe(asks);
  expect(summary.needsYou.length + summary.asks.length).toBe(3);
  // Host/room counts still describe agents; questions have no room claim.
  expect(summary.hosts[0]!.counts.needsYou).toBe(1);
  expect(
    townSummary(projection, calls, NO_METRICS, projection.activityOf, []).counts
      .needsYou,
  ).toBe(1);
});

test("Summary lists and counts every room beyond presentation admission", () => {
  const projection = office(
    Object.fromEntries(
      Array.from({ length: 129 }, (_, index) => [`room-${index}`, ["working"]]),
    ),
  );
  expect(projection.rooms).toHaveLength(128);
  const summary = townSummary(projection, [], NO_METRICS);
  expect(summary.hosts[0]!.rooms).toHaveLength(129);
  expect(summary.hosts[0]!.counts.working).toBe(129);
  expect(summary.counts.working).toBe(129);
  expect(new Set(summary.hosts[0]!.rooms.map((room) => room.key)).size).toBe(
    129,
  );
});

test("spend says there is no cost data rather than zero", () => {
  const projection = office({ alpha: ["working"] });
  expect(townSummary(projection, [], NO_METRICS).spend).toEqual({
    available: false,
  });
  const spend = townSummary(projection, [], {
    ...NO_METRICS,
    health: "available",
    sourceCount: 1,
    providerId: "metrics",
    observedAt: 42,
    totalCostUsd: 4.1,
    models: [
      {
        provider: "p",
        model: "m",
        usage: {},
        costUsd: 4.1,
        costKind: "reported",
      },
    ],
  }).spend;
  expect(spend).toEqual({
    available: true,
    totalUsd: 4.1,
    observedAt: 42,
    providerId: "metrics",
    models: [{ model: "m", costUsd: 4.1 }],
  });
});

test("ages read as people say them", () => {
  expect(townSummaryAge(null, 0)).toBe("");
  expect(townSummaryAge(0, 30_000)).toBe("just now");
  expect(townSummaryAge(0, 12 * 60_000)).toBe("12 m ago");
  expect(townSummaryAge(0, 3 * 3_600_000)).toBe("3 h ago");
  expect(townSummaryAge(0, 50 * 3_600_000)).toBe("2 d ago");
});

test("the summary panel reads in attention order and never shows zero spend", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { TownSummaryPanel } = await import("./TownSummaryPanel");
  const projection = office({ alpha: ["blocked", "done"], beta: ["idle"] });
  const asks: WorldAsk[] = [
    {
      id: "question-one",
      at: 500,
      actor: { label: "Synthetic worker", verified: true },
      question: "Ship the synthetic change?",
      options: ["Ship", "Wait"],
      owner_only: true,
    },
  ];
  const summary = townSummary(
    projection,
    callsOf(projection),
    NO_METRICS,
    projection.activityOf,
    asks,
  );
  const html = renderToStaticMarkup(
    createElement(TownSummaryPanel, {
      summary,
      now: 500 + 12 * 60_000,
      onOpenAgent: () => {},
      onShowRoom: () => {},
      onAnswer: async () => null,
    }),
  );
  const order = [
    "Needs you",
    "Finished, not reviewed",
    "Hosts and rooms",
    "Spend",
  ];
  const at = order.map((heading) => html.indexOf(heading));
  expect(at.every((index) => index >= 0)).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
  expect(html).toContain("waiting 12 m");
  expect(html).toContain("Synthetic worker");
  expect(html).toContain("asks: Ship the synthetic change?");
  expect(html).toContain("blocked: needs input");
  expect(html).toContain('aria-label="Your answer to Synthetic worker"');
  // A finish's time is its last activity, never claimed as the finish.
  expect(html).toContain("last active");
  expect(html).not.toContain("finished 1");
  expect(html).toContain("Show room alpha in Town");
  expect(html).toContain("No cost data");
  expect(html).not.toContain("$0.00");
});

test("blocked rows show supplied reasons and fall back for missing or blank labels", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { TownSummaryPanel } = await import("./TownSummaryPanel");
  const projection = office({ alpha: ["blocked", "blocked", "blocked"] });
  const calls = callsOf(projection);
  calls[0]!.agent.stateLabels.blocked = "Approve the synthetic change";
  calls[1]!.agent.stateLabels.blocked = "  ";
  delete calls[2]!.agent.stateLabels.blocked;
  const html = renderToStaticMarkup(
    createElement(TownSummaryPanel, {
      summary: townSummary(projection, calls, NO_METRICS),
      now: 1000,
      onOpenAgent: () => {},
      onShowRoom: () => {},
      onAnswer: async () => null,
    }),
  );
  expect(html).toContain("blocked: Approve the synthetic change");
  expect(html.match(/blocked: needs input/g)).toHaveLength(2);
});
