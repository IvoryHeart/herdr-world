/*
 * Test fixtures for the Town scene model: a manual clock and synthetic
 * offices. Test-only; the scene itself never imports this module.
 */

import type { Pane, Tab, Workspace } from "../../../types";
import {
  projectWorldOffice,
  TOWN_PRESENTATION_BOUNDS,
  type HerdrOfficeProjection,
} from "../../herdrOfficeProjection";
import type { WorldRuntimeConnection } from "../../runtimeStore";
import { buildWorldObject } from "../../worldObject";
import type { TownClock } from "./ports";

/** A clock that moves only when the test advances it. */
export function manualClock(start = 10_000) {
  let now = start;
  let wall = 1_700_000_000_000;
  let timers: { at: number; run: () => void }[] = [];
  const clock: TownClock = {
    now: () => now,
    wall: () => wall,
    after(ms, run) {
      const timer = { at: now + ms, run };
      timers.push(timer);
      return () => {
        timers = timers.filter((entry) => entry !== timer);
      };
    },
  };
  return {
    clock,
    pending: () => timers.length,
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const next = timers
          .filter((timer) => timer.at <= until)
          .sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        timers = timers.filter((timer) => timer !== next);
        wall += next.at - now;
        now = next.at;
        next.run();
      }
      wall += until - now;
      now = until;
    },
  };
}

/** One synthetic host's connection: workspaces with tabs of the given agent states. */
function connection(
  connectionId: string,
  rooms: Record<string, readonly string[]>,
  isDefault: boolean,
): WorldRuntimeConnection {
  const workspaces: Workspace[] = Object.keys(rooms).map((id, index) => ({
    workspace_id: id,
    number: index + 1,
    label: id,
    focused: index === 0,
    pane_count: rooms[id]!.length,
    tab_count: rooms[id]!.length,
    active_tab_id: `${id}:t0`,
    agent_status: "working",
  }));
  const tabs: Tab[] = [];
  const panes: Pane[] = [];
  for (const [id, statuses] of Object.entries(rooms))
    statuses.forEach((status, index) => {
      const tabId = `${id}:t${index}`;
      tabs.push({
        tab_id: tabId,
        workspace_id: id,
        number: index + 1,
        label: `Tab ${index + 1}`,
        focused: index === 0,
        pane_count: status.endsWith("+") ? 2 : 1,
        agent_status: status.replace(/\+$/, ""),
      });
      // A status ending in "+" gives its tab a second pane (another seat).
      const agentStatus = status.replace(/\+$/, "");
      for (const suffix of status.endsWith("+") ? ["", "b"] : [""])
        panes.push({
          pane_id: `${tabId}:p${suffix}`,
          terminal_id: `term-${tabId}${suffix}`,
          workspace_id: id,
          tab_id: tabId,
          focused: suffix === "",
          agent: "claude",
          agent_status: agentStatus,
          revision: 1,
        });
    });
  return {
    connectionId,
    label: connectionId,
    source: "saved-profile",
    isDefault,
    state: "ready",
    generation: 1,
    snapshotGeneration: 1,
    stale: false,
    actionable: true,
    snapshot: { workspaces, tabs, panes, agents: [] },
  };
}

/** Synthetic hosts by name, each with its workspaces' tabs; the first is focused. */
export function town(
  hosts: Record<string, Record<string, readonly string[]>>,
): HerdrOfficeProjection {
  const names = Object.keys(hosts);
  return projectWorldOffice(
    buildWorldObject(
      names.map((name, index) => connection(name, hosts[name]!, index === 0)),
      names[0]!,
    ),
    1,
    null,
    TOWN_PRESENTATION_BOUNDS,
  );
}

/** One synthetic host: each workspace with tabs of the given agent states. */
export function office(
  rooms: Record<string, readonly string[]>,
): HerdrOfficeProjection {
  return town({ studio: rooms });
}

export const working = (count: number) => Array<string>(count).fill("working");
