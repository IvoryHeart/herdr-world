import { townLocation } from "./TownRail";
import { createContext, useContext } from "react";
import type { WorldAsk } from "../worldAsks";
import type { WorldObject } from "../worldObject";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import type { TownAsker } from "./townAskers";
export const AnswerOutboxContext = createContext<() => void>(() => {});
export const useOpenAnswerOutbox = () => useContext(AnswerOutboxContext);
export type AnswerRecipientView = {
  name: string;
  location: string;
  target: TownAsker | null;
};
/** Opening a current conversation is an explicit owner action, never a resend target. */
export function answerRecipientView(
  ask: WorldAsk,
  world: Pick<WorldObject, "leaves">,
  office: Pick<HerdrOfficeProjection, "roster" | "paneRoster">,
): AnswerRecipientView {
  const leaf = world.leaves.find(
    (leaf) =>
      !leaf.stale &&
      leaf.actionable &&
      leaf.connectionId === ask.actor.connection_id &&
      leaf.pane.pane_id === ask.actor.pane_id &&
      Boolean(ask.actor.terminal_id) &&
      leaf.terminalId === ask.actor.terminal_id,
  );
  const agent =
    leaf && office.roster.find((entry) => entry.agent.nodeId === leaf.id);
  const pane =
    leaf && office.paneRoster.find((entry) => entry.device.nodeId === leaf.id);
  return {
    name: ask.actor.name ?? ask.actor.label,
    location: townLocation(agent ?? pane) || "original host",
    target: agent
      ? {
          name: agent.agent.displayLabel,
          key: agent.agent.key,
          terminal: false,
        }
      : pane
        ? {
            name: pane.device.displayLabel,
            key: pane.device.nodeId,
            terminal: true,
          }
        : null,
  };
}
