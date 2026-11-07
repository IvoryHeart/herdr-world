import type { OfficeAgent, OfficePaneDevice } from "../herdrOfficeProjection";
import {
  townReceptionMark,
  type TownReceptionMark,
} from "./townReceptionFilter";

/** Reception keeps urgent blocking, owner questions and finishes in that order. */
export function townReceptionVisitors(
  agents: readonly OfficeAgent[],
  terminals: readonly OfficePaneDevice[],
  asking: ReadonlySet<string>,
) {
  const rank = (entry: OfficeAgent | OfficePaneDevice) =>
    "semanticStatus" in entry && entry.semanticStatus === "blocked"
      ? 0
      : asking.has("semanticStatus" in entry ? entry.key : entry.nodeId)
        ? 1
        : 2;
  return [...agents, ...terminals].sort((a, b) => rank(a) - rank(b));
}

/**
 * One building's reception board under its filter: the visitors it takes in
 * reception order, and the agents (and asking terminals) the filter keeps at
 * their desks, counted by mark. `attention` is Town's attention order
 * (townAttention); `held` the agents whose mark reception does not take.
 */
export function townReceptionBoard(
  hostKey: string,
  attention: readonly OfficeAgent[],
  terminalQuestions: readonly OfficePaneDevice[],
  asking: ReadonlySet<string>,
  held: ReadonlySet<string>,
  takes: ReadonlySet<TownReceptionMark>,
) {
  const kept: OfficeAgent[] = [];
  const keptCounts = new Map<TownReceptionMark, number>();
  const keep = (mark: TownReceptionMark, n = 1) =>
    keptCounts.set(mark, (keptCounts.get(mark) ?? 0) + n);
  const agents = attention.filter((agent) => {
    if (agent.hostKey !== hostKey) return false;
    const mark = townReceptionMark(agent.semanticStatus, asking.has(agent.key));
    if (!mark) return false;
    if (!held.has(agent.key)) return true;
    kept.push(agent);
    keep(mark);
    return false;
  });
  const terminals = takes.has("ask") ? terminalQuestions : [];
  if (!takes.has("ask") && terminalQuestions.length)
    keep("ask", terminalQuestions.length);
  return {
    visitors: townReceptionVisitors(agents, terminals, asking),
    kept,
    keptCounts,
  };
}
