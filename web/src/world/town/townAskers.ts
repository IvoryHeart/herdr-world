import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import { askerName, type WorldAsk } from "../worldAsks";
import { askLeaves } from "../worldAskTargets";
import type { WorldObject } from "../worldObject";

/**
 * Who asked a question, as Town names them, and what Open agent opens: the
 * asking agent, or the terminal of an asking pane that has no agent.
 */
export type TownAsker = { name: string; key: string | null; terminal: boolean };

/**
 * Each open question's asker: the agent or terminal World places that
 * question on, named as Town labels its desk, else the name the ask carries.
 * Every question resolves on its own, so several from one pane all place.
 */
export function townAskers(
  asks: readonly WorldAsk[],
  world: Pick<WorldObject, "leaves">,
  office: Pick<HerdrOfficeProjection, "roster" | "paneRoster">,
): ReadonlyMap<string, TownAsker> {
  if (asks.length === 0) return new Map();
  const leaves = askLeaves(asks, world);
  const agents = new Map(
    office.roster.map((entry) => [entry.agent.key, entry.agent.displayLabel]),
  );
  const terminals = new Map(
    office.paneRoster.map((entry) => [
      entry.device.nodeId,
      entry.device.displayLabel,
    ]),
  );
  return new Map(
    asks.map((ask) => {
      const key = leaves.get(ask.id) ?? null;
      const agent = key === null ? undefined : agents.get(key);
      const name =
        agent ??
        (key === null ? undefined : terminals.get(key)) ??
        askerName(ask);
      return [
        ask.id,
        { name, key, terminal: key !== null && agent === undefined },
      ];
    }),
  );
}
