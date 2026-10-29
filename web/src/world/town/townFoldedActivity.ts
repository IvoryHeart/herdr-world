import type {
  HerdrOfficeProjection,
  OfficeAgent,
} from "../herdrOfficeProjection";
import { officeReadModel } from "../officeReadModel";
import type { WorldAsk } from "../worldAsks";
import type { TownCall } from "./TownRail";

export type TownFoldedActivity = { needsYou: boolean; done: boolean };
export const NO_FOLDED_ACTIVITY: ReadonlyMap<string, TownFoldedActivity> =
  new Map();

/** Hidden attention follows the rail's calls and qualified asks, never raw done status. */
export function townFoldedActivity(
  office: HerdrOfficeProjection,
  calls: readonly TownCall[],
  asks: readonly WorldAsk[],
): ReadonlyMap<string, TownFoldedActivity> {
  const verified = asks.filter(
    ({ actor }) => actor.verified && actor.connection_id && actor.pane_id,
  );
  if (!calls.length && !verified.length) return NO_FOLDED_ACTIVITY;
  const shown = new Map(
    office.rooms.map((room) => [
      room.key,
      new Set(room.desks.map((desk) => desk.key)),
    ]),
  );
  const result = new Map<string, TownFoldedActivity>();
  const add = (agent: OfficeAgent, kind: keyof TownFoldedActivity) => {
    const desks = shown.get(agent.roomKey);
    if (!desks || !agent.deskKey || desks.has(agent.deskKey)) return;
    const activity = result.get(agent.roomKey) ?? {
      needsYou: false,
      done: false,
    };
    activity[kind] = true;
    result.set(agent.roomKey, activity);
  };
  for (const call of calls)
    add(call.agent, call.kind === "blocked" ? "needsYou" : "done");
  if (verified.length) {
    const read = officeReadModel(office);
    for (const { actor } of verified) {
      const agent = read.agentForPane(actor.connection_id!, actor.pane_id!);
      if (
        agent &&
        (!actor.terminal_id ||
          actor.terminal_id === agent.currentTerminalRef.nativeId)
      )
        add(agent, "needsYou");
    }
  }
  return result.size ? result : NO_FOLDED_ACTIVITY;
}

export function townFoldedActivityLabel(
  activity: TownFoldedActivity | undefined,
) {
  return [
    activity?.needsYou ? "Hidden desks need you" : "",
    activity?.done ? "Hidden desks have unreviewed completions" : "",
  ]
    .filter(Boolean)
    .join(". ");
}
