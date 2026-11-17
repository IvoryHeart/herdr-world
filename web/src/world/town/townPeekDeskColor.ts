import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import {
  resolveTerminal,
  type TerminalColor,
  type TerminalColors,
} from "../terminalColor";
import { setTerminalColor } from "../useTerminalColors";
import { townDeskColorTarget } from "./townModel";

/** The peeked agent's desk colour: its terminal's, shared across World. */
export function townPeekDeskColor(
  office: HerdrOfficeProjection,
  terminalColors: TerminalColors,
  agentKey: string,
) {
  const deskKey = office.paneRoster.find(
    ({ device }) => device.agentKey === agentKey,
  )?.device.deskKey;
  const desk = deskKey
    ? office.deskRoster.find((entry) => entry.desk.key === deskKey)?.desk
    : null;
  const target = desk ? townDeskColorTarget(office, desk) : null;
  if (!target) return null;
  const { color, own } = resolveTerminal(terminalColors, target);
  return {
    current: color,
    // Only the tab's own colour can be reset; a workspace's is not its.
    custom: own,
    onColor: (color: TerminalColor | null) =>
      void setTerminalColor(target, color),
  };
}
