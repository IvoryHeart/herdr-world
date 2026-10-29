import type { OfficeAgent, OfficePaneDevice } from "../herdrOfficeProjection";

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
