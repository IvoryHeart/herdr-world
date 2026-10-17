/**
 * Herdr reports an agent that finished its turn as idle once it is seen, so
 * Town notices the finish itself: an agent that goes from working (or
 * waiting) to idle while Town is open has finished, and stays finished until
 * the user checks it. Town presents it as done, so it waits at reception with
 * its work on the desk, and a checked one goes for a break.
 */

import { useEffect, useRef, useState } from "react";
import type {
  HerdrOfficeProjection,
  OfficeAgent,
} from "../herdrOfficeProjection";

const BUSY = new Set(["working", "blocked"]);

/**
 * One observation, in a single pass over the roster: agents that went from
 * busy to idle have finished; agents that are busy again, or gone, are no
 * longer finished. `renewed` are agents whose earlier completion no longer
 * counts as seen: they just finished or just started working again.
 */
export function nextTownFinished<
  T extends Pick<OfficeAgent, "key" | "semanticStatus">,
>(
  before: ReadonlyMap<string, string>,
  agents: Iterable<T>,
  current: ReadonlySet<string>,
) {
  const statuses = new Map<string, string>();
  const started: string[] = [];
  const renewed: T[] = [];
  let next: Set<string> | null = null;
  const change = () => (next ??= new Set(current));
  for (const agent of agents) {
    const status = agent.semanticStatus;
    statuses.set(agent.key, status);
    const was = before.get(agent.key);
    const busy = BUSY.has(status);
    if (was !== undefined && BUSY.has(was) && status === "idle") {
      started.push(agent.key);
      renewed.push(agent);
      if (!current.has(agent.key)) change().add(agent.key);
    } else if (busy) {
      if (!BUSY.has(was ?? "")) renewed.push(agent);
      if (current.has(agent.key)) change().delete(agent.key);
    }
  }
  for (const key of current) if (!statuses.has(key)) change().delete(key);
  return { statuses, started, renewed, finished: next ?? current };
}

/**
 * The agents Town shows: every agent of a presented room, as Town's model
 * admits them, independent of Office's room, reception and bar caps. Only
 * these are stored, so a dense roster costs one cheap pass.
 */
export function townTrackedAgents(office: HerdrOfficeProjection) {
  const rooms = new Set(office.rooms.map((room) => room.key));
  const agents: OfficeAgent[] = [];
  for (const { agent } of office.roster)
    if (rooms.has(agent.roomKey)) agents.push(agent);
  return agents;
}

/** Agents that finished while Town was watching and are not yet checked. */
export function useTownFinished(office: HerdrOfficeProjection) {
  const previous = useRef(new Map<string, string>());
  const [finished, setFinished] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const finishedRef = useRef(finished);
  finishedRef.current = finished;
  /** Agents whose earlier completion no longer counts as seen. */
  const [fresh, setFresh] = useState<readonly OfficeAgent[]>([]);
  useEffect(() => {
    const step = nextTownFinished(
      previous.current,
      townTrackedAgents(office),
      finishedRef.current,
    );
    previous.current = step.statuses;
    if (step.finished !== finishedRef.current) {
      finishedRef.current = step.finished;
      setFinished(step.finished);
    }
    if (step.renewed.length) setFresh(step.renewed);
  }, [office]);
  const dismiss = (key: string) => {
    const current = finishedRef.current;
    if (!current.has(key)) return;
    const next = new Set(current);
    next.delete(key);
    finishedRef.current = next;
    setFinished(next);
  };
  return { finished, fresh, dismiss };
}

/**
 * The projection as Town presents it: agents that finished unchecked are
 * done, and done agents the user has checked are idle.
 */
export function withTownFinished(
  office: HerdrOfficeProjection,
  finished: ReadonlySet<string>,
  checked: ReadonlySet<string>,
): HerdrOfficeProjection {
  const changes = (agent: OfficeAgent) =>
    (agent.semanticStatus === "idle" && finished.has(agent.key)) ||
    (agent.semanticStatus === "done" &&
      checked.has(agent.key) &&
      !finished.has(agent.key));
  if (!office.roster.some(({ agent }) => changes(agent))) return office;
  const swapped = new Map<OfficeAgent, OfficeAgent>();
  const present = (agent: OfficeAgent) => {
    if (!changes(agent)) return agent;
    let next = swapped.get(agent);
    if (!next) {
      next = {
        ...agent,
        semanticStatus: agent.semanticStatus === "idle" ? "done" : "idle",
      };
      swapped.set(agent, next);
    }
    return next;
  };
  // Only containers holding a changed agent are copied.
  const list = (agents: OfficeAgent[]) =>
    agents.some(changes) ? agents.map(present) : agents;
  return {
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
}
