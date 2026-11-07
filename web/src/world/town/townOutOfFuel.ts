/**
 * Out of fuel: an agent that stopped because its harness hit a usage limit
 * (the service reads the stop from the agent's own session records, see
 * shared/usageStop.ts). Town presents it as quiet, never waiting on you,
 * since there is nothing to answer: it stays slumped at its desk with an
 * empty fuel can and a clock, and counts on its own. A stop ends by itself
 * once its reset time passes or the agent works again.
 */

import { useEffect, useMemo, useState } from "react";
import {
  usageStopCurrent,
  type AgentUsageStop,
} from "../../../../shared/usageStop";
import { withOfficeReadModel } from "../officeReadModel";
import type {
  HerdrOfficeProjection,
  OfficeAgent,
} from "../herdrOfficeProjection";

const NONE: ReadonlyMap<string, AgentUsageStop> = new Map();
const NO_ROOMS: ReadonlyMap<string, number> = new Map();
/** Out-of-fuel agents by room key, for each projection this file presents. */
const roomsOf = new WeakMap<
  HerdrOfficeProjection,
  ReadonlyMap<string, number>
>();

/** How many agents in each room Town shows out of fuel, by room key. */
export function townOutOfFuelRooms(
  office: HerdrOfficeProjection,
): ReadonlyMap<string, number> {
  return roomsOf.get(office) ?? NO_ROOMS;
}

/** The stops that still hold at `now`; the same map when all of them do. */
export function currentUsageStops(
  stops: ReadonlyMap<string, AgentUsageStop>,
  now: number,
): ReadonlyMap<string, AgentUsageStop> {
  if (!stops.size) return NONE;
  let next: Map<string, AgentUsageStop> | null = null;
  for (const [key, stop] of stops)
    if (!usageStopCurrent(stop, now)) (next ??= new Map(stops)).delete(key);
  return next ?? stops;
}

/** When the next of these stops resets, or null when none names a time. */
export function nextUsageStopReset(
  stops: ReadonlyMap<string, AgentUsageStop>,
): number | null {
  let next: number | null = null;
  for (const stop of stops.values())
    if (stop.resets_at !== null && (next === null || stop.resets_at < next))
      next = stop.resets_at;
  return next;
}

/** The stops that hold now, dropping each one when its reset time passes. */
export function useCurrentUsageStops(
  stops: ReadonlyMap<string, AgentUsageStop>,
): ReadonlyMap<string, AgentUsageStop> {
  const [now, setNow] = useState(() => Date.now());
  // The same map until a stop ends, so Town's projection is not rebuilt.
  const current = useMemo(() => currentUsageStops(stops, now), [stops, now]);
  const reset = nextUsageStopReset(current);
  useEffect(() => {
    if (reset === null) return;
    // Long timers fire early on some browsers; the next render re-arms.
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(2 ** 31 - 1, Math.max(0, reset - Date.now()) + 50),
    );
    return () => window.clearTimeout(timer);
  }, [reset]);
  return current;
}

/** One agent's stop while it holds (Chat's Now status), or null. */
export function useCurrentUsageStop(
  stop: AgentUsageStop | null | undefined,
): AgentUsageStop | null {
  const harness = stop?.harness;
  const at = stop?.at;
  const resets = stop?.resets_at;
  const stops = useMemo(
    (): ReadonlyMap<string, AgentUsageStop> =>
      harness === undefined || at === undefined || resets === undefined
        ? NONE
        : new Map([["", { harness, at, resets_at: resets }]]),
    [harness, at, resets],
  );
  return useCurrentUsageStops(stops).get("") ?? null;
}

/** Whether Town shows this agent out of fuel: stopped, and not working again. */
const outOfFuel = (agent: OfficeAgent, stop: AgentUsageStop | undefined) =>
  stop !== undefined && !agent.stale && agent.semanticStatus !== "working";

/**
 * The projection as Town presents it: an agent stopped on a usage limit is
 * quiet (idle) and carries its stop, so it stays at its desk and leaves the
 * reception queue and the call rail; a working agent has fuel again.
 */
export function withTownOutOfFuel(
  office: HerdrOfficeProjection,
  stops: ReadonlyMap<string, AgentUsageStop>,
): HerdrOfficeProjection {
  if (!stops.size) return office;
  const changes = (agent: OfficeAgent) =>
    outOfFuel(agent, stops.get(agent.key));
  if (!office.roster.some(({ agent }) => changes(agent))) return office;
  const swapped = new Map<OfficeAgent, OfficeAgent>();
  const present = (agent: OfficeAgent) => {
    if (!changes(agent)) return agent;
    let next = swapped.get(agent);
    if (!next) {
      next = {
        ...agent,
        semanticStatus: "idle",
        usageStop: stops.get(agent.key)!,
      };
      swapped.set(agent, next);
    }
    return next;
  };
  // Only containers holding a changed agent are copied.
  const list = (agents: OfficeAgent[]) =>
    agents.some(changes) ? agents.map(present) : agents;
  const result = {
    ...office,
    rooms: office.rooms.map((room) => {
      const roomAgents = list(room.roomAgents);
      return roomAgents === room.roomAgents ? room : { ...room, roomAgents };
    }),
    receptions: office.receptions.map((reception) => {
      const waitingAgents = list(reception.waitingAgents);
      return waitingAgents === reception.waitingAgents
        ? reception
        : { ...reception, waitingAgents };
    }),
    barAgents: list(office.barAgents),
    roster: office.roster.map((entry) =>
      changes(entry.agent) ? { ...entry, agent: present(entry.agent) } : entry,
    ),
  };
  const rooms = new Map<string, number>();
  for (const agent of swapped.values())
    rooms.set(agent.roomKey, (rooms.get(agent.roomKey) ?? 0) + 1);
  roomsOf.set(result, rooms);
  return withOfficeReadModel(office, result, swapped);
}
