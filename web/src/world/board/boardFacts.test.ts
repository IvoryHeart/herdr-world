import { expect, test } from "bun:test";
import type { Pane, Tab, Workspace } from "../../types";
import {
  createOfficeProjector,
  prepareWorldOffice,
  TOWN_PRESENTATION_BOUNDS,
} from "../herdrOfficeProjection";
import { EMPTY_OFFICE_OBSERVABILITY } from "../officeObservability";
import type { WorldRuntimeConnection } from "../runtimeStore";
import { buildWorldObject } from "../worldObject";
import { townCalls, unseenTownCompletions } from "../town/TownRail";
import { withTownFinished } from "../town/townFinished";
import { townHostExpenses, townCityExpenses } from "../town/townExpenses";
import { townPlaceEconomy } from "../town/townPlaceUsage";
import { townSummary } from "../town/townSummary";
import { usageFixture } from "../testing/usageFixture";
import type { WorldAsk } from "../worldAsks";
import { boardFacts } from "./useBoardFacts";
import {
  boardAgentNow,
  boardCountsText,
  boardFuelText,
  boardHostGauges,
  boardPlaceText,
  boardTotalText,
} from "./boardFactsText";

/** One synthetic host: one workspace, one agent per tab, given statuses. */
function world(statuses: string[]) {
  const workspaces: Workspace[] = [
    {
      workspace_id: "w1",
      number: 1,
      label: "orbit",
      focused: true,
      pane_count: statuses.length,
      tab_count: statuses.length,
      active_tab_id: "w1:t0",
      agent_status: "working",
    },
  ];
  const tabs: Tab[] = [];
  const panes: Pane[] = [];
  statuses.forEach((status, index) => {
    const tabId = `w1:t${index}`;
    tabs.push({
      tab_id: tabId,
      workspace_id: "w1",
      number: index + 1,
      label: `Tab ${index + 1}`,
      focused: index === 0,
      pane_count: 1,
      agent_status: status,
    });
    panes.push({
      pane_id: `${tabId}:p`,
      terminal_id: `term-${tabId}`,
      workspace_id: "w1",
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
  return buildWorldObject([connection], "studio");
}

test("Board's facts are Town's: finishes, reviews and asks counted as Town counts them", async () => {
  const shown = world(["working", "blocked", "done", "done", "idle", "idle"]);
  await prepareWorldOffice(shown);
  const office = createOfficeProjector(TOWN_PRESENTATION_BOUNDS)(
    shown,
    1,
    null,
  );
  const keys = office.roster.map(({ agent }) => agent.key);
  // Town saw the fifth agent finish; the fourth's finish is reviewed.
  const finished = new Set([keys[4]!]);
  const reviewed = new Set([keys[3]!]);
  const facts = boardFacts(office, finished, reviewed, shown, [], new Map());

  expect(facts.summary.counts).toMatchObject({
    working: 1,
    needsYou: 1,
    finished: 2,
    quiet: 2,
    agents: 6,
    buildings: 1,
  });
  expect(facts.summary.finished.map((item) => item.agent.key).sort()).toEqual(
    [keys[2]!, keys[4]!].sort(),
  );
  // Town's presentation, by node: a seen finish is done, a reviewed one quiet.
  const status = (index: number) =>
    facts.presented.get(office.roster[index]!.agent.nodeId);
  expect([0, 1, 2, 3, 4, 5].map(status)).toEqual([
    "working",
    "blocked",
    "done",
    "idle",
    "done",
    "idle",
  ]);

  // The same numbers Town's own chain gives (TownView.tsx).
  const presented = withTownFinished(office, finished, reviewed);
  const byKey = new Map(presented.roster.map((e) => [e.agent.key, e]));
  const town = townSummary(
    presented,
    townCalls(
      presented.roster,
      new Map(),
      unseenTownCompletions(presented.roster, reviewed),
      (key) => byKey.get(key),
    ),
    EMPTY_OFFICE_OBSERVABILITY,
  );
  expect(facts.summary.counts).toEqual(town.counts);
  expect(facts.summary.hosts.map((host) => host.counts)).toEqual(
    town.hosts.map((host) => host.counts),
  );
});

test("Waiting includes open questions, as Town's board counts them", async () => {
  const shown = world(["blocked", "idle"]);
  await prepareWorldOffice(shown);
  const office = createOfficeProjector(TOWN_PRESENTATION_BOUNDS)(
    shown,
    1,
    null,
  );
  const ask = { id: "q1" } as WorldAsk;
  const facts = boardFacts(
    office,
    new Set(),
    new Set(),
    shown,
    [ask],
    new Map(),
  );
  expect(facts.summary.counts.needsYou).toBe(2);
  expect(boardCountsText(facts.summary.hosts[0]!.counts)).toBe(
    "1 waiting · 1 quiet",
  );
});

test("An agent's now line: its step with Town's amber timer, finish review and idle time", () => {
  const now = 10 * 3_600_000;
  const step = { kind: "test" as const, since: now - 14 * 60_000, task: null };
  expect(
    boardAgentNow({ status: "working", step, lastActivityAt: now, now }),
  ).toEqual({ text: "tests 14m", long: true });
  expect(
    boardAgentNow({
      status: "working",
      step: { ...step, since: now - 2 * 60_000 },
      lastActivityAt: now,
      now,
    }),
  ).toEqual({ text: "tests 2m", long: false });
  // Town saw it finish: not reviewed, though Herdr says idle.
  expect(
    boardAgentNow({
      status: "idle",
      presented: "done",
      step: undefined,
      lastActivityAt: now - 5 * 60_000,
      now,
    })?.text,
  ).toBe("Not reviewed");
  // Herdr says done; Town shows it reviewed.
  expect(
    boardAgentNow({
      status: "done",
      presented: "idle",
      step: undefined,
      lastActivityAt: undefined,
      now,
    })?.text,
  ).toBe("Reviewed");
  expect(
    boardAgentNow({
      status: "idle",
      step: undefined,
      lastActivityAt: now - 3 * 3_600_000 - 12 * 60_000,
      now,
    })?.text,
  ).toBe("Idle 3 h 12 m");
  expect(
    boardAgentNow({
      status: "blocked",
      step: undefined,
      lastActivityAt: now,
      now,
    }),
  ).toBeNull();
});

test("Expenses read Town's totals: host and World as its boards, a workspace as its room card", () => {
  const snapshot = usageFixture({
    rows: [
      {
        connection: "studio",
        workspace: "w1",
        tab: "w1:t0",
        pane: "w1:t0:p",
        input: 1_200_000,
      },
    ],
    sources: [{ connection: "studio", state: "available" }],
  });
  const state = { status: "ready" as const, snapshot, receivedAt: 0 };
  const city = townCityExpenses(state);
  const host = townHostExpenses(state, "studio");
  expect(city.status).toBe("ready");
  expect(boardTotalText(host)).toBe(boardTotalText(city));
  expect(boardTotalText(host)).toMatch(/^\$[\d.]+ est\.$/);
  expect(boardTotalText(townHostExpenses(state, "elsewhere"))).toBe("no data");
  expect(boardTotalText({ status: "loading" })).toBe("…");
  const room = townPlaceEconomy(state, {
    kind: "room",
    target: {
      connectionId: "studio",
      generation: 1,
      nativeId: "w1",
      worldId: "w1",
      kind: "workspace",
    },
  });
  expect(boardPlaceText(room)).toMatch(/^~\$[\d.]+$/);
  expect(boardPlaceText({ status: "none" })).toBe("none");
});

test("Limits per host carry the reading's age", () => {
  const now = Date.UTC(2026, 10, 7, 15);
  const limits = [
    {
      connection_id: "studio",
      connection_generation: 1,
      harness: "claude" as const,
      state: "available" as const,
      source: "claude-status-line" as const,
      observed_at: now - 3 * 60_000,
      reason: null,
      reached: null,
      windows: [
        { window_minutes: 300, used_percent: 40, resets_at: null },
        { window_minutes: 10080, used_percent: 90, resets_at: null },
      ],
    },
    {
      connection_id: "elsewhere",
      connection_generation: 1,
      harness: "codex" as const,
      state: "available" as const,
      source: "codex-session-log" as const,
      observed_at: now,
      reason: null,
      reached: null,
      windows: [{ window_minutes: 300, used_percent: 10, resets_at: null }],
    },
  ] as unknown as Parameters<typeof boardHostGauges>[0];
  const gauges = boardHostGauges(limits, "studio", now);
  expect(gauges.map((gauge) => gauge.name)).toEqual(["Claude"]);
  expect(boardFuelText(gauges[0]!, now)).toBe(
    "Claude 5 h 60% left · week 10% left (low) · seen 3 min ago",
  );
});
