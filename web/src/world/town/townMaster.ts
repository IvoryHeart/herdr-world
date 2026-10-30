import type { OfficeAgent } from "../herdrOfficeProjection";
import { yieldWorldTask } from "../worldObject";

type NamedAgent = Pick<OfficeAgent, "key" | "agentName" | "displayLabel">;
const LOOKUP_BATCH = 256;

/** Preserve native-name priority and roster order without a long render task. */
export async function findTownMaster<T extends NamedAgent>(
  roster: readonly { agent: T }[],
  name: string,
  isCurrent: () => boolean = () => true,
  yieldTask: () => Promise<void> = yieldWorldTask,
): Promise<T | undefined> {
  const wanted = name.trim().toLowerCase();
  if (!wanted || !isCurrent()) return undefined;
  let shownName: T | undefined;
  for (let start = 0; start < roster.length; start += LOOKUP_BATCH) {
    if (!isCurrent()) return undefined;
    const end = Math.min(start + LOOKUP_BATCH, roster.length);
    for (let index = start; index < end; index += 1) {
      const agent = roster[index]!.agent;
      if (agent.agentName?.toLowerCase() === wanted)
        return isCurrent() ? agent : undefined;
      if (!shownName && agent.displayLabel.toLowerCase() === wanted)
        shownName = agent;
    }
    if (end < roster.length) await yieldTask();
  }
  return isCurrent() ? shownName : undefined;
}
