/**
 * The Town scale scene: a synthetic World at the owner's maximum scale
 * (3 hosts, 8 rooms per host, 11–15 desks per room, 1–4 panes per desk) with
 * a fixed mix of working, asking, blocked, finished, idle and unknown agents.
 *
 * Every name, path and identifier is synthetic. The scene is deterministic so
 * the legibility report (docs/design/town-at-scale.md) and its captures can be
 * reproduced. Open it in a running World with `?scene=town-scale`.
 */

import type { Pane, Tab, Workspace } from "../../types";
import type { WorldRuntimeConnection } from "../runtimeStore";

export const TOWN_SCALE_SCENE = "town-scale";

const HOSTS = ["atlas", "nova", "zephyr"] as const;
const ROOMS = [
  [
    "orbit",
    "harbor",
    "lantern",
    "meadow",
    "quarry",
    "summit",
    "tidepool",
    "vale",
  ],
  ["beacon", "canyon", "delta", "ember", "fjord", "grove", "haven", "isle"],
  [
    "juniper",
    "kestrel",
    "lagoon",
    "mesa",
    "nectar",
    "oasis",
    "prairie",
    "ridge",
  ],
] as const;
/** Desks per room, 11–15, so rooms differ in length. */
const DESKS = [15, 11, 13, 14, 12, 15, 11, 13] as const;
const DESK_NAMES = [
  "api",
  "auth",
  "billing",
  "build",
  "cache",
  "docs",
  "e2e",
  "ingest",
  "lint",
  "migrate",
  "notify",
  "perf",
  "release",
  "search",
  "ui",
] as const;
const HARNESSES = ["claude", "codex", "pi"] as const;

/**
 * An agent's state in the scene. Asking and blocked are both Herdr's
 * `blocked` (the agent waits for a person); their task summaries differ.
 */
export type TownScaleState =
  | "working"
  | "asking"
  | "blocked"
  | "done"
  | "idle"
  | "unknown";

/** Cumulative weights out of 100 for an agent's state. */
const MIX: readonly [TownScaleState, number][] = [
  ["working", 46],
  ["asking", 52],
  ["blocked", 56],
  ["done", 68],
  ["idle", 88],
  ["unknown", 100],
];
const SUMMARY: Record<TownScaleState, string | undefined> = {
  working: "Implementing the change",
  asking: "Asks: allow running the migration?",
  blocked: "Blocked: CI failing on the lint step",
  done: "Finished: pull request ready",
  idle: undefined,
  unknown: undefined,
};

/** A fixed linear congruential sequence: the same scene on every load. */
function sequence(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function stateFor(roll: number): TownScaleState {
  const value = roll * 100;
  return MIX.find(([, upTo]) => value < upTo)![0];
}

function herdrStatus(state: TownScaleState) {
  return state === "asking" ? "blocked" : state;
}

function host(index: number, random: () => number): WorldRuntimeConnection {
  const name = HOSTS[index]!;
  const workspaces: Workspace[] = [];
  const tabs: Tab[] = [];
  const panes: Pane[] = [];
  ROOMS[index]!.forEach((room, r) => {
    const workspaceId = `${name}-${room}`;
    const deskCount = DESKS[(r + index * 3) % DESKS.length]!;
    let roomPanes = 0;
    for (let d = 0; d < deskCount; d++) {
      const tabId = `${workspaceId}-t${d}`;
      // 1–4 panes: most desks are one agent with a shell or two beside it.
      const paneCount = 1 + Math.floor(random() * 4);
      // Seat 0 is an agent on most desks; a second agent sometimes shares one.
      const agentSeats = new Set<number>();
      if (random() < 0.8) agentSeats.add(0);
      if (paneCount > 1 && random() < 0.2) agentSeats.add(1);
      let deskStatus = "unknown";
      for (let p = 0; p < paneCount; p++) {
        const agent = agentSeats.has(p);
        const state = agent ? stateFor(random()) : null;
        const status = state ? herdrStatus(state) : "unknown";
        if (status === "working" || deskStatus === "unknown")
          deskStatus = status;
        panes.push({
          pane_id: `${tabId}-p${p}`,
          terminal_id: `${tabId}-term${p}`,
          workspace_id: workspaceId,
          tab_id: tabId,
          focused: p === 0,
          cwd: `/synthetic/${room}`,
          agent: agent
            ? HARNESSES[Math.floor(random() * HARNESSES.length)]!
            : "",
          agent_status: status,
          task_summary: state ? SUMMARY[state] : undefined,
          revision: 1,
        });
      }
      roomPanes += paneCount;
      tabs.push({
        tab_id: tabId,
        workspace_id: workspaceId,
        number: d + 1,
        label: DESK_NAMES[d % DESK_NAMES.length]!,
        focused: d === 0,
        pane_count: paneCount,
        agent_status: deskStatus,
      });
    }
    workspaces.push({
      workspace_id: workspaceId,
      number: r + 1,
      label: room,
      focused: r === 0,
      pane_count: roomPanes,
      tab_count: deskCount,
      active_tab_id: `${workspaceId}-t0`,
      cwd: `/synthetic/${room}`,
      agent_status: "working",
    });
  });
  return {
    connectionId: `scene-${name}`,
    label: name,
    source: "saved-profile",
    isDefault: index === 0,
    state: "ready",
    generation: 1,
    snapshotGeneration: 1,
    stale: false,
    actionable: true,
    snapshot: { workspaces, tabs, panes, agents: [] },
  };
}

/** The scene's three synthetic hosts, identical on every call. */
export function townScaleConnections(): WorldRuntimeConnection[] {
  const random = sequence(0x7363616c);
  return HOSTS.map((_, index) => host(index, random));
}

/** Whether this page asked for the scale scene (`?scene=town-scale`). */
export function townScaleSceneRequested(search: string) {
  return new URLSearchParams(search).get("scene") === TOWN_SCALE_SCENE;
}
