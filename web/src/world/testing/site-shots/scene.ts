/**
 * The website's Town scene: two synthetic hosts with four project rooms and a
 * crew of agents at work, so herdr.world's screenshots show World as a busy
 * day looks. Every host, room, desk, step, cost and pull request is
 * synthetic: nothing here comes from a real machine, account or repository.
 *
 * scripts/site-screenshots.ts captures it in the production TownCanvas.
 */

import type {
  UsageContext,
  UsageLimit,
  WorldUsageSnapshot,
} from "../../../../../shared/usage";
import type { Pane, Tab, Workspace } from "../../../types";
import type { WorldRuntimeConnection } from "../../runtimeStore";
import type { TownStepKind } from "../../town/townSteps";
import { usageFixture, type UsageFixtureRow } from "../usageFixture";

/** An agent's place in the scene: its state and, when working, its step. */
type SiteAgent = {
  harness: "claude" | "codex" | "pi";
  state: "working" | "blocked" | "done" | "idle";
  /** What it is doing, as the agent's own task summary. */
  task?: string;
  step?: { kind: TownStepKind; task: string; minutes: number };
  /** Context used, as a share of the model's window. */
  context?: number;
  /** Uncached input tokens today; costs follow the synthetic price table. */
  tokens?: number;
};

type SiteDesk = { label: string; agents: SiteAgent[]; shells?: number };
type SiteRoom = { label: string; desks: SiteDesk[] };
type SiteHost = { label: string; rooms: SiteRoom[] };

const work = (
  harness: SiteAgent["harness"],
  kind: TownStepKind,
  task: string,
  minutes: number,
  extra: Partial<SiteAgent> = {},
): SiteAgent => ({
  harness,
  state: "working",
  task,
  step: { kind, task, minutes },
  tokens: 60_000 + task.length * 900,
  ...extra,
});

export const SITE_HOSTS: readonly SiteHost[] = [
  {
    label: "studio",
    rooms: [
      {
        label: "storefront",
        desks: [
          {
            label: "checkout",
            agents: [
              work("claude", "edit", "Validate the address form", 2, {
                context: 0.91,
              }),
            ],
            shells: 1,
          },
          {
            label: "search",
            agents: [work("codex", "test", "Run the search tests", 4)],
          },
          {
            label: "a11y",
            agents: [
              {
                harness: "claude",
                state: "blocked",
                task: "Asks: may I update the colour tokens?",
                tokens: 48_000,
              },
            ],
          },
          {
            label: "images",
            agents: [
              {
                harness: "pi",
                state: "done",
                task: "Finished: lazy-load product images",
                tokens: 36_000,
              },
            ],
          },
        ],
      },
      {
        label: "api",
        desks: [
          {
            label: "auth",
            agents: [work("codex", "command", "Migrate the session table", 13)],
          },
          {
            label: "billing",
            agents: [
              {
                harness: "claude",
                state: "done",
                task: "Finished: retry failed invoices",
                tokens: 92_000,
              },
            ],
          },
          {
            label: "rate-limit",
            agents: [work("claude", "read", "Read the gateway config", 1)],
            shells: 1,
          },
        ],
      },
    ],
  },
  {
    label: "buildbox",
    rooms: [
      {
        label: "mobile",
        desks: [
          {
            label: "onboarding",
            agents: [work("claude", "think", "Plan the welcome screens", 0)],
          },
          {
            label: "push",
            agents: [
              {
                harness: "codex",
                state: "blocked",
                task: "Blocked: which notification provider?",
                tokens: 51_000,
              },
            ],
          },
          {
            label: "release",
            agents: [{ harness: "pi", state: "idle", tokens: 12_000 }],
          },
        ],
      },
      {
        label: "docs",
        desks: [
          {
            label: "guides",
            agents: [work("claude", "web", "Check the API reference", 3)],
          },
          {
            label: "changelog",
            agents: [
              {
                harness: "codex",
                state: "done",
                task: "Finished: draft the release notes",
                tokens: 30_000,
              },
            ],
          },
          {
            label: "examples",
            agents: [
              work("codex", "edit", "Update the quick-start sample", 1, {
                context: 0.62,
              }),
            ],
          },
        ],
      },
    ],
  },
];

const hostId = (host: number) => `site-host-${host}`;
const roomId = (host: number, room: number) => `site-${host}-room-${room}`;
const tabId = (host: number, room: number, desk: number) =>
  `${roomId(host, room)}-desk-${desk}`;
const paneId = (host: number, room: number, desk: number, seat: number) =>
  `${tabId(host, room, desk)}-pane-${seat}`;

function deskStatus(desk: SiteDesk) {
  const states = desk.agents.map((agent) => agent.state);
  for (const state of ["working", "blocked", "done", "idle"] as const)
    if (states.includes(state)) return state;
  return "unknown";
}

/** The scene's hosts as World's aggregate observation shows them. */
export function siteConnections(): WorldRuntimeConnection[] {
  return SITE_HOSTS.map((host, h) => {
    const workspaces: Workspace[] = [];
    const tabs: Tab[] = [];
    const panes: Pane[] = [];
    host.rooms.forEach((room, r) => {
      let roomPanes = 0;
      room.desks.forEach((desk, d) => {
        const seats = desk.agents.length + (desk.shells ?? 0);
        roomPanes += seats;
        tabs.push({
          tab_id: tabId(h, r, d),
          workspace_id: roomId(h, r),
          number: d + 1,
          label: desk.label,
          focused: d === 0,
          pane_count: seats,
          agent_status: deskStatus(desk),
        });
        for (let seat = 0; seat < seats; seat++) {
          const agent = desk.agents[seat];
          panes.push({
            pane_id: paneId(h, r, d, seat),
            terminal_id: `${paneId(h, r, d, seat)}-terminal`,
            workspace_id: roomId(h, r),
            tab_id: tabId(h, r, d),
            focused: seat === 0,
            cwd: `/projects/${room.label}`,
            agent: agent?.harness ?? "",
            agent_status: agent?.state ?? "unknown",
            task_summary: agent?.task,
            revision: 1,
          });
        }
      });
      workspaces.push({
        workspace_id: roomId(h, r),
        number: r + 1,
        label: room.label,
        focused: r === 0,
        pane_count: roomPanes,
        tab_count: room.desks.length,
        active_tab_id: tabId(h, r, 0),
        cwd: `/projects/${room.label}`,
        agent_status: "working",
      });
    });
    return {
      connectionId: hostId(h),
      label: host.label,
      source: "saved-profile",
      isDefault: h === 0,
      state: "ready",
      generation: 1,
      snapshotGeneration: 1,
      stale: false,
      actionable: true,
      snapshot: { workspaces, tabs, panes, agents: [] },
    };
  });
}

/** Every agent with its pane, for steps, contexts and usage rows. */
function agents() {
  return SITE_HOSTS.flatMap((host, h) =>
    host.rooms.flatMap((room, r) =>
      room.desks.flatMap((desk, d) =>
        desk.agents.map((agent, seat) => ({
          agent,
          connection: hostId(h),
          workspace: roomId(h, r),
          tab: tabId(h, r, d),
          pane: paneId(h, r, d, seat),
        })),
      ),
    ),
  );
}

const TOOL: Record<TownStepKind, string | null> = {
  edit: "Edit",
  test: "Bash",
  command: "Bash",
  read: "Read",
  web: "WebFetch",
  agent: "Task",
  think: null,
};

/**
 * What `agent_conversation.latest` says about one pane: a working agent's
 * running step, as its transcript would give it, or nothing for the rest.
 */
export function siteConversation(paneId: string, now: number) {
  const found = agents().find(({ pane }) => pane === paneId);
  const step = found?.agent.step;
  const tool = step && TOOL[step.kind];
  return {
    conversation_version: 1,
    pane_id: paneId,
    agent: found?.agent.harness ?? null,
    agent_status: found?.agent.state ?? null,
    session_binding: "exact",
    status: "ok",
    unavailable: null,
    latest: null,
    latest_request: step?.task ?? null,
    running_tool: tool
      ? {
          name: tool,
          summary: step.task,
          started_at: new Date(
            now - step.minutes * 60_000 - 20_000,
          ).toISOString(),
        }
      : null,
  };
}

const MODEL = {
  claude: "example-large",
  codex: "example-large",
  pi: "example-small",
};
const WINDOW = 200_000;

/**
 * Today's and the week's synthetic usage: costs for every room, two context
 * readings (one tired agent) and both subscription gauges for the fuel board.
 */
export function siteUsage(now: number): WorldUsageSnapshot {
  const rows: UsageFixtureRow[] = agents().map(
    ({ agent, connection, workspace, tab, pane }) => ({
      connection,
      workspace,
      tab,
      pane,
      harness: agent.harness,
      model: MODEL[agent.harness],
      input: agent.tokens ?? 20_000,
      cacheRead: (agent.tokens ?? 20_000) * 6,
    }),
  );
  const sources = SITE_HOSTS.flatMap((_, h) =>
    (["claude", "codex", "pi"] as const).map((harness) => ({
      connection: hostId(h),
      harness,
      state: "available" as const,
    })),
  );
  const today = usageFixture({ rows, sources, observedAt: now });
  const yesterday = new Date(now - 86_400_000).toISOString().slice(0, 10);
  const week = usageFixture({
    rows: [
      ...rows,
      ...rows.map((row) => ({ ...row, day: yesterday, input: row.input * 3 })),
    ],
    sources,
    window: "7d",
    observedAt: now,
  });
  const contexts: UsageContext[] = agents().flatMap(
    ({ agent, connection, workspace, tab, pane }) =>
      agent.context
        ? [
            {
              connection_id: connection,
              connection_generation: 1,
              workspace_id: workspace,
              tab_id: tab,
              pane_id: pane,
              harness: agent.harness,
              model: MODEL[agent.harness],
              used_tokens: Math.round(agent.context * WINDOW),
              window_tokens: WINDOW,
              observed_at: now,
            },
          ]
        : [],
  );
  const limit = (
    harness: UsageLimit["harness"],
    windows: [minutes: number, used: number, resetsIn: number][],
  ): UsageLimit => ({
    connection_id: hostId(0),
    connection_generation: 1,
    harness,
    state: "available",
    source: harness === "claude" ? "claude-status-line" : "codex-session-log",
    reason: null,
    observed_at: now - 4 * 60_000,
    reached: null,
    windows: windows.map(([minutes, used, resetsIn]) => ({
      window_minutes: minutes,
      used_percent: used,
      resets_at: now + resetsIn * 60_000,
    })),
  });
  return {
    ...week,
    today: {
      total: today.total,
      unattributed: today.unattributed,
      rollups: today.rollups,
    },
    contexts,
    limits: [
      limit("claude", [
        [300, 38, 134],
        [10_080, 61, 3 * 1440 + 200],
      ]),
      limit("codex", [
        [300, 72, 52],
        [10_080, 44, 5 * 1440 + 90],
      ]),
    ],
  };
}
