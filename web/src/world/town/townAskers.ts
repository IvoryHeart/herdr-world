import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import { askerName, type WorldAsk } from "../worldAsks";
import { asksForWorld } from "../worldAskTargets";
import type { WorldObject } from "../worldObject";

/** Who asked a question, as Town names them, and the agent Open agent opens. */
export type TownAsker = { name: string; key: string | null };

/**
 * Each open question's asker: the agent or terminal World places it on,
 * named as Town labels its desk, else the name the ask carries.
 */
export function townAskers(
  asks: readonly WorldAsk[],
  world: Pick<WorldObject, "leaves">,
  office: Pick<HerdrOfficeProjection, "roster" | "paneRoster">,
): ReadonlyMap<string, TownAsker> {
  const placed = new Map(
    [...asksForWorld(asks, world)].map(([key, ask]) => [ask.id, key]),
  );
  const labels = new Map<string, string>();
  for (const entry of office.paneRoster)
    labels.set(entry.device.nodeId, entry.device.displayLabel);
  for (const entry of office.roster)
    labels.set(entry.agent.key, entry.agent.displayLabel);
  return new Map(
    asks.map((ask) => {
      const key = placed.get(ask.id) ?? null;
      return [
        ask.id,
        { name: (key && labels.get(key)) || askerName(ask), key },
      ];
    }),
  );
}
