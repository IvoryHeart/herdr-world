import type {
  HerdrOfficeProjection,
  OfficeAgent,
} from "../herdrOfficeProjection";

/**
 * Cached entities may be inspected as history, never opened as live
 * endpoints. A live herdr-core pane, desk or agent opens too, in World's
 * Inspector (its terminal, or an agent's Chat): World only cannot mark its
 * work reviewed, and that restriction belongs on review controls, never on
 * opening it.
 */
export function townTargetActionable(
  office: HerdrOfficeProjection,
  key: string,
) {
  const target =
    office.paneRoster.find((x) => x.device.key === key)?.device ??
    office.roster.find((x) => x.agent.key === key)?.agent ??
    office.deskRoster.find((x) => x.desk.key === key)?.desk;
  if (!target || target.stale) return false;
  return (
    target.canOpenInSpaces ||
    ("coreChat" in target && Boolean(target.coreChat)) ||
    ("coreOpen" in target && Boolean(target.coreOpen))
  );
}

/**
 * What tapping a desk opens: its one pane, else the pane Herdr reports
 * focused, else an agent there that needs you (waiting, then finished),
 * else the pane most recently active. A desk with more panes than seats and
 * none of those to go by returns null: the chooser lists them. Otherwise the
 * seated agent, else the first pane. The key is an agent's when the pane
 * holds one, else the pane's. The same for Herdr TUI and herdr-core desks.
 */
export function townDeskOpenKey(
  office: Pick<HerdrOfficeProjection, "deskRoster" | "roster" | "paneRoster">,
  deskKey: string,
): string | null {
  const desk = office.deskRoster.find((x) => x.desk.key === deskKey)?.desk;
  if (!desk) return null;
  const panes = office.paneRoster
    .filter(({ device }) => device.deskKey === deskKey && !device.stale)
    .map(({ device }) => device)
    .sort((a, b) => a.order - b.order);
  const keyOf = (device: (typeof panes)[number]) =>
    device.agentKey ?? device.key;
  if (panes.length === 1 && desk.observedPaneCount <= 1)
    return keyOf(panes[0]!);
  const focused = panes.find((device) => device.focused);
  if (focused) return keyOf(focused);
  const calling = townDeskAgentKey(office, deskKey);
  const callingAgent = calling
    ? office.roster.find((x) => x.agent.key === calling)?.agent
    : undefined;
  if (
    callingAgent &&
    (callingAgent.semanticStatus === "blocked" ||
      callingAgent.semanticStatus === "done")
  )
    return callingAgent.key;
  let latest: (typeof panes)[number] | undefined;
  for (const device of panes)
    if (
      typeof device.lastActivityAt === "number" &&
      (!latest || device.lastActivityAt > (latest.lastActivityAt ?? 0))
    )
      latest = device;
  if (latest) return keyOf(latest);
  if (desk.observedPaneCount > desk.paneDevices.length) return null;
  return calling ?? (panes[0] ? keyOf(panes[0]) : null);
}

/**
 * Whether a tap on the desk opens something at once (townDeskOpenKey), so a
 * touch tap opens it rather than the desk's summary card first.
 *
 * @internal
 */
export function townDeskOpensAtOnce(
  office: HerdrOfficeProjection,
  deskKey: string,
) {
  const key = townDeskOpenKey(office, deskKey);
  return key !== null && townTargetActionable(office, key);
}

/**
 * Whether a tap on `deskKey` opens its table's card, with `open` the table
 * whose card is open. Only a table drawn with its nameplate (its room among
 * `shownRooms`), and with no pane a tap opens at once, has a card; a second
 * tap on the same table does what a tap always did.
 */
export function townDeskCardOpens(
  office: HerdrOfficeProjection,
  deskKey: string | null,
  open: string | null,
  roomKey: string | undefined,
  shownRooms: ReadonlySet<string>,
): boolean {
  return (
    deskKey !== null &&
    deskKey !== open &&
    !townDeskOpensAtOnce(office, deskKey) &&
    !!roomKey &&
    shownRooms.has(roomKey)
  );
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

/**
 * The agent a table stands for: one that needs you (waiting, then finished)
 * even while it is away at reception, else the one seated there.
 */
export function townDeskAgentKey(
  office: Pick<HerdrOfficeProjection, "deskRoster" | "roster">,
  deskKey: string,
) {
  const rank = (agent: OfficeAgent) =>
    agent.semanticStatus === "blocked"
      ? 0
      : agent.semanticStatus === "done"
        ? 1
        : 2;
  const occupant = office.deskRoster.find(({ desk }) => desk.key === deskKey)
    ?.desk.occupantAgentKey;
  let best: OfficeAgent | null = null;
  for (const { agent } of office.roster)
    if (
      agent.deskKey === deskKey &&
      (!best ||
        rank(agent) < rank(best) ||
        (rank(agent) === rank(best) && agent.key === occupant))
    )
      best = agent;
  return best?.key ?? occupant ?? null;
}
