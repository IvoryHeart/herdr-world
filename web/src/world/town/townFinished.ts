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
 * One observation: agents that went from busy to idle have finished; agents
 * that are busy again, or gone, are no longer finished.
 */
export function nextTownFinished(
  before: ReadonlyMap<string, string>,
  agents: readonly Pick<OfficeAgent, "key" | "semanticStatus">[],
  current: ReadonlySet<string>,
) {
  const statuses = new Map<string, string>();
  const started: string[] = [];
  const next = new Set(current);
  for (const agent of agents) {
    statuses.set(agent.key, agent.semanticStatus);
    const was = before.get(agent.key);
    if (was && BUSY.has(was) && agent.semanticStatus === "idle") {
      started.push(agent.key);
      next.add(agent.key);
    } else if (BUSY.has(agent.semanticStatus)) next.delete(agent.key);
  }
  for (const key of next) if (!statuses.has(key)) next.delete(key);
  const same =
    next.size === current.size && [...next].every((key) => current.has(key));
  return { statuses, started, finished: same ? current : next };
}

/** Agents that finished while Town was watching and are not yet checked. */
export function useTownFinished(office: HerdrOfficeProjection) {
  const previous = useRef(new Map<string, string>());
  const [finished, setFinished] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const finishedRef = useRef(finished);
  finishedRef.current = finished;
  const [fresh, setFresh] = useState<readonly OfficeAgent[]>([]);
  useEffect(() => {
    const agents = office.roster.map(({ agent }) => agent);
    const step = nextTownFinished(
      previous.current,
      agents,
      finishedRef.current,
    );
    previous.current = step.statuses;
    finishedRef.current = step.finished;
    setFinished(step.finished);
    if (step.started.length)
      setFresh(agents.filter((agent) => step.started.includes(agent.key)));
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
  return {
    ...office,
    rooms: office.rooms.map((room) => ({
      ...room,
      roomAgents: room.roomAgents.map(present),
    })),
    receptions: office.receptions.map((reception) => ({
      ...reception,
      waitingAgents: reception.waitingAgents.map(present),
    })),
    barAgents: office.barAgents.map(present),
    roster: office.roster.map((entry) => ({
      ...entry,
      agent: present(entry.agent),
    })),
  };
}
