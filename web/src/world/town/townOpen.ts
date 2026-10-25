import type {
  HerdrOfficeProjection,
  OfficeAgent,
} from "../herdrOfficeProjection";

/** Cached entities may be inspected as history, never opened as live endpoints. */
export function townTargetActionable(
  office: HerdrOfficeProjection,
  key: string,
) {
  const target =
    office.paneRoster.find((x) => x.device.key === key)?.device ??
    office.roster.find((x) => x.agent.key === key)?.agent ??
    office.deskRoster.find((x) => x.desk.key === key)?.desk;
  return Boolean(target && !target.stale && target.canOpenInSpaces);
}

export async function inspectTownTerminal(
  office: HerdrOfficeProjection,
  key: string,
  open: (nodeId: string) => unknown,
  reviewed?: (agent: OfficeAgent) => void,
) {
  if (!townTargetActionable(office, key)) return;
  const device = office.paneRoster.find((x) => x.device.key === key)?.device;
  if (device) {
    await open(device.nodeId);
    return;
  }
  const agent = office.roster.find((x) => x.agent.key === key)?.agent;
  if (agent) {
    await open(agent.nodeId);
    if (agent.semanticStatus === "done") reviewed?.(agent);
    return;
  }
  const desk = office.deskRoster.find((x) => x.desk.key === key)?.desk;
  if (!desk) return;
  const occupant = desk.occupantAgentKey
    ? office.roster.find((x) => x.agent.key === desk.occupantAgentKey)?.agent
    : null;
  const nodeId = occupant?.nodeId ?? desk.terminalSelectionKeys[0];
  if (nodeId) await open(nodeId);
}
