import { expect, test } from "bun:test";
import type { Pane, Tab, Workspace } from "../../types";
import {
  projectWorldOffice,
  TOWN_PRESENTATION_BOUNDS,
} from "../herdrOfficeProjection";
import type { OfficeObservability } from "../officeObservability";
import type { WorldRuntimeConnection } from "../runtimeStore";
import { buildWorldObject } from "../worldObject";
import type { TownCall } from "./TownRail";
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
  return projectWorldOffice(
    buildWorldObject([connection], "studio"),
    1,
    null,
    TOWN_PRESENTATION_BOUNDS,
  );
}

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
  const summary = townSummary(projection, callsOf(projection), NO_METRICS);
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
  const summary = townSummary(projection, callsOf(projection), NO_METRICS);
  const html = renderToStaticMarkup(
    createElement(TownSummaryPanel, {
      summary,
      now: 500 + 12 * 60_000,
      onOpenAgent: () => {},
      onShowRoom: () => {},
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
  // A finish's time is its last activity, never claimed as the finish.
  expect(html).toContain("last active");
  expect(html).not.toContain("finished 1");
  expect(html).toContain("Show room alpha in Town");
  expect(html).toContain("No cost data");
  expect(html).not.toContain("$0.00");
});
