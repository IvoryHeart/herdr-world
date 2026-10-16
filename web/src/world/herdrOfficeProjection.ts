import type {
  WorldAgentStatus,
  WorldHostState,
  WorldLeafObject,
  WorldObject,
  WorldSpaceObject,
} from "./worldObject";
import { boundedOptionalText, yieldWorldTask } from "./worldObject";

export const OFFICE_PRESENTATION_BOUNDS = Object.freeze({
  waitingAgentsPerReception: 8,
  paneDevicesPerDesk: 4,
  barAgents: 16,
  rosterPage: 50,
});

export type OfficeQualifiedTarget = {
  connectionId: string;
  generation: number;
  kind: "workspace" | "tab" | "pane" | "terminal";
  nativeId: string;
  worldId: string;
};

export type OfficeHost = {
  key: string;
  displayLabel: string;
  accessibleLabel?: string;
  displayOrder: number;
  connectionState: WorldHostState;
  observed: boolean;
  stale: boolean;
  compatibleWithWorld: boolean;
  compatibleWithSpaces: boolean;
  selected: boolean;
  deterministicSkin: { themeIndex: number; badge: string };
};

export type OfficeAgentDestination = "room" | "reception" | "bar";
export type OfficeAgentPlacement = "seated" | "standing" | "waiting" | "bar";

export type OfficeAgent = {
  key: string;
  nodeId: string;
  currentPaneRef: OfficeQualifiedTarget;
  currentTerminalRef: OfficeQualifiedTarget;
  currentTabRef: OfficeQualifiedTarget;
  deskKey: string | null;
  observedGeneration: number;
  roomKey: string;
  hostKey: string;
  displayLabel: string;
  taskSummary?: string;
  semanticStatus: WorldAgentStatus;
  stateLabels: Partial<Record<WorldAgentStatus, string>>;
  focused: boolean;
  destination: OfficeAgentDestination;
  placement: OfficeAgentPlacement;
  stale: boolean;
  canOpenInSpaces: boolean;
  characterIndex: number;
};

export type OfficePaneDevice = {
  key: string;
  nodeId: string;
  paneRef: OfficeQualifiedTarget;
  terminalRef: OfficeQualifiedTarget;
  deskKey: string;
  hostKey: string;
  roomKey: string;
  displayLabel: string;
  order: number;
  stale: boolean;
  canOpenInSpaces: boolean;
  agentKey?: string;
};

export type OfficePaneRosterEntry = {
  device: OfficePaneDevice;
  roomLabel: string;
  deskLabel: string;
  hostLabel: string;
  presented: boolean;
};

export type OfficeDesk = {
  key: string;
  hostKey: string;
  roomKey: string;
  tabRef: OfficeQualifiedTarget;
  terminalSelectionKeys: string[];
  observedGeneration: number;
  displayLabel: string;
  order: number;
  stale: boolean;
  canOpenInSpaces: boolean;
  occupantAgentKey?: string;
  completionAgentKeys: string[];
  paneDevices: OfficePaneDevice[];
  observedPaneCount: number;
  omittedPaneCount: number;
};

export type OfficeRoom = {
  key: string;
  hostKey: string;
  workspaceRef: OfficeQualifiedTarget;
  observedGeneration: number;
  displayLabel: string;
  accessibleLabel?: string;
  order: number;
  stale: boolean;
  canOpenInSpaces: boolean;
  desks: OfficeDesk[];
  roomAgents: OfficeAgent[];
  omittedDeskCount: number;
  omittedAgentCount: number;
  observedDeskCount: number;
  observedAgentCount: number;
};

export type OfficeReception = {
  key: string;
  hostKey: string;
  hostLabel: string;
  stale: boolean;
  waitingAgents: OfficeAgent[];
  observedWaitingAgentCount: number;
  overflowCount: number;
};

export type OfficeRosterEntry = {
  agent: OfficeAgent;
  roomKey: string;
  roomLabel: string;
  hostKey: string;
  hostLabel: string;
  roomPresented: boolean;
  deskPresented: boolean;
  destinationPresented: boolean;
};

export type OfficeDeskRosterEntry = {
  desk: OfficeDesk;
  roomLabel: string;
  hostLabel: string;
  presented: boolean;
};

export type OfficeRoomRosterEntry = {
  key: string;
  hostKey: string;
  hostLabel: string;
  workspaceRef: OfficeQualifiedTarget;
  observedGeneration: number;
  displayLabel: string;
  order: number;
  stale: boolean;
  canOpenInSpaces: boolean;
  presented: boolean;
};

export type OfficeCoverage = {
  configuredHosts: number;
  observedHosts: number;
  compatibleHosts: number;
  connectingHosts: number;
  staleHosts: number;
  observedWorkspaces: number;
  observedDesks: number;
  observedAgents: number;
  status: Record<WorldAgentStatus, number>;
  omittedRooms: number;
  omittedDesks: number;
  omittedRoomAgents: number;
  omittedReceptionDesks: number;
  omittedWaitingAgents: number;
  omittedBarAgents: number;
};

export type HerdrOfficeProjection = {
  version: 1;
  generatedAt: number;
  hosts: OfficeHost[];
  rooms: OfficeRoom[];
  receptions: OfficeReception[];
  barAgents: OfficeAgent[];
  roomRoster: OfficeRoomRosterEntry[];
  deskRoster: OfficeDeskRosterEntry[];
  paneRoster: OfficePaneRosterEntry[];
  roster: OfficeRosterEntry[];
  unresolved: Array<{ kind: "room-bound"; count: number }>;
  coverage: OfficeCoverage;
  presentationBounds: typeof OFFICE_PRESENTATION_BOUNDS & {
    totalRooms: number;
    renderedRooms: number;
    totalDesks: number;
    renderedDesks: number;
    totalRoomAgents: number;
    renderedRoomAgents: number;
    totalReceptionDesks: number;
    renderedReceptionDesks: number;
    totalWaitingAgents: number;
    renderedWaitingAgents: number;
    totalBarAgents: number;
    renderedBarAgents: number;
  };
};

type ProjectedRoom = {
  host: OfficeHost;
  source: WorldSpaceObject;
  room: Omit<
    OfficeRoom,
    | "desks"
    | "roomAgents"
    | "omittedDeskCount"
    | "omittedAgentCount"
    | "observedDeskCount"
    | "observedAgentCount"
  >;
  desks: OfficeDesk[];
  agents: OfficeAgent[];
};

const projectionInputs = new WeakMap<
  HerdrOfficeProjection,
  {
    allRooms: ProjectedRoom[];
    deskRoster: OfficeDeskRosterEntry[];
    paneRoster: OfficePaneRosterEntry[];
    roster: OfficeRosterEntry[];
    prepared: PreparedOffice | undefined;
  }
>();

const preparedProjections = new WeakMap<WorldObject, HerdrOfficeProjection>();
const presentedRoomCache = new WeakMap<WorldSpaceObject, OfficeRoom>();
const presentationSignatures = new WeakMap<object, string>();
function presentationSignature(item: object) {
  let value = presentationSignatures.get(item);
  if (value === undefined) {
    value = JSON.stringify(item);
    presentationSignatures.set(item, value);
  }
  return value;
}
function presentRoom(
  entry: ProjectedRoom,
  selectedId: string | null,
): OfficeRoom {
  if (
    !selectedId ||
    !entry.source.children.some((leaf) => leaf.id === selectedId)
  ) {
    selectedId = null;
    const cached = presentedRoomCache.get(entry.source);
    if (cached) return cached;
  }
  const desks = entry.desks.map((desk) => {
    const devices = boundedWithPriority(
      projectPaneDevices(entry.source.children, desk),
      OFFICE_PRESENTATION_BOUNDS.paneDevicesPerDesk,
      (device) => device.nodeId === selectedId,
    );
    return {
      ...desk,
      paneDevices: devices,
      omittedPaneCount: Math.max(0, desk.observedPaneCount - devices.length),
    };
  });
  const seated = new Set(
    desks.flatMap(({ occupantAgentKey }) =>
      occupantAgentKey ? [occupantAgentKey] : [],
    ),
  );
  const deskOrder = new Map(desks.map((desk, index) => [desk.key, index]));
  const roomAgents = entry.agents
    .filter(({ destination }) => destination === "room")
    .map((agent) => ({
      ...agent,
      placement: seated.has(agent.key)
        ? ("seated" as const)
        : ("standing" as const),
    }))
    .sort((left, right) => compareRoomAgents(left, right, deskOrder));
  const result: OfficeRoom = {
    ...entry.room,
    desks,
    roomAgents,
    omittedDeskCount: Math.max(0, entry.source.coverage.tabs - desks.length),
    omittedAgentCount: Math.max(
      0,
      entry.source.coverage.status.working +
        entry.source.coverage.status.unknown -
        roomAgents.length,
    ),
    observedDeskCount: entry.source.coverage.tabs,
    observedAgentCount: entry.source.coverage.agents,
  };
  if (!selectedId) {
    presentedRoomCache.set(entry.source, result);
    presentationSignatures.set(result, JSON.stringify(result));
  }
  return result;
}

/** Retain immutable topology across selection overlays and equivalent refreshes. */
export function createOfficeProjector() {
  let previousWorld: WorldObject | null = null;
  let previous: HerdrOfficeProjection | null = null;
  let previousSelected: string | null = null;
  const intern = <T extends { key: string }>(next: T[], prior: T[]) => {
    const byKey = new Map(prior.map((item) => [item.key, item]));
    const result = next.map((item) => {
      const old = byKey.get(item.key);
      return old && presentationSignature(old) === presentationSignature(item)
        ? old
        : item;
    });
    return result.length === prior.length &&
      result.every((item, index) => item === prior[index])
      ? prior
      : result;
  };
  return (
    world: WorldObject,
    generatedAt: number,
    selectedId: string | null,
  ): HerdrOfficeProjection => {
    const preparedProjection = preparedProjections.get(world);
    if (preparedProjection && previousWorld !== world) {
      previous = preparedProjection;
      previousWorld = world;
      previousSelected = null;
    }
    let next: HerdrOfficeProjection | null = null;
    const inputs = previous && projectionInputs.get(previous);
    if (
      previous &&
      previousWorld === world &&
      selectedId === previousSelected
    ) {
      next = { ...previous, generatedAt };
    } else if (previous && previousWorld === world && inputs?.prepared) {
      const selection = selectedId ? world.nodeById.get(selectedId) : undefined;
      const selectedSpaceId =
        selection?.kind === "space" ? selection.id : selection?.parentId;
      const oldSelection = previousSelected
        ? world.nodeById.get(previousSelected)
        : undefined;
      const oldSpaceId =
        oldSelection?.kind === "space"
          ? oldSelection.id
          : oldSelection?.parentId;
      // Selection can reserve another compact pane device. Recompute its room
      // when that artwork admission changes, including when selection clears.
      const boundedAdmissionUnchanged = inputs.allRooms
        .filter(
          (entry) =>
            entry.source.id === selectedSpaceId ||
            entry.source.id === oldSpaceId,
        )
        .every((entry) =>
          entry.desks.every(
            (desk) =>
              desk.observedPaneCount <=
                OFFICE_PRESENTATION_BOUNDS.paneDevicesPerDesk ||
              [selectedId, previousSelected].every(
                (id) =>
                  !id ||
                  !desk.terminalSelectionKeys.includes(id) ||
                  projectPaneDevices(entry.source.children, desk)
                    .slice(0, OFFICE_PRESENTATION_BOUNDS.paneDevicesPerDesk)
                    .some((device) => device.nodeId === id),
              ),
          ),
        );
      const hosts = previous.hosts.map((host, index) => {
        const selected = selection
          ? host.key ===
            world.hosts.find(
              (item) => item.connectionId === selection.connectionId,
            )?.id
          : world.hosts[index]!.selectedHost;
        return host.selected === selected ? host : { ...host, selected };
      });
      const inRoom =
        !selection ||
        selection.kind === "host" ||
        selection.kind === "space" ||
        (selection.kind === "agent"
          ? previous.rooms.some((room) =>
              room.roomAgents.some((agent) => agent.key === selectedId),
            )
          : previous.rooms.some((room) =>
              room.desks.some((desk) =>
                desk.paneDevices.some((device) => device.nodeId === selectedId),
              ),
            ));
      const previousMovedQueue =
        previousSelected &&
        (previous.barAgents.some((agent) => agent.key === previousSelected) ||
          previous.receptions.some((reception) =>
            reception.waitingAgents.some(
              (agent) => agent.key === previousSelected,
            ),
          ));
      if (inRoom && !previousMovedQueue && boundedAdmissionUnchanged) {
        const ranges = inputs.prepared.ranges.get(selectedSpaceId ?? "");
        next = {
          ...previous,
          generatedAt,
          hosts,
          deskRoster: prioritizeRoomRoster(inputs.deskRoster, ranges?.desks),
          paneRoster: prioritizeRoomRoster(inputs.paneRoster, ranges?.panes),
          roster: prioritizeRoomRoster(inputs.roster, ranges?.agents),
        };
      }
    }
    if (next && inputs) projectionInputs.set(next, inputs);
    else next = projectWorldOffice(world, generatedAt, selectedId);
    if (previous && next.rooms !== previous.rooms) {
      // Compare content once at projection admission, never once per canvas frame.
      next.rooms = intern(next.rooms, previous.rooms);
      next.hosts = intern(next.hosts, previous.hosts);
      next.receptions = intern(next.receptions, previous.receptions);
      next.barAgents = intern(next.barAgents, previous.barAgents);
    }
    previousWorld = world;
    previousSelected = selectedId;
    previous = next;
    return next;
  };
}

export function projectWorldOffice(
  world: WorldObject,
  generatedAt: number,
  selectedId: string | null = null,
): HerdrOfficeProjection {
  const cached = preparedProjections.get(world);
  if (cached && selectedId === null) {
    const result = { ...cached, generatedAt };
    projectionInputs.set(result, projectionInputs.get(cached)!);
    return result;
  }
  const steps = projectWorldOfficeSteps(world, generatedAt, selectedId);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

function* projectWorldOfficeSteps(
  world: WorldObject,
  generatedAt: number,
  selectedId: string | null,
): Generator<void, HerdrOfficeProjection> {
  const selection = selectedId ? world.nodeById.get(selectedId) : undefined;
  const selectedSpaceId =
    selection?.kind === "space" ? selection.id : selection?.parentId;
  const selectedFirst = (left: { key: string }, right: { key: string }) =>
    Number(right.key === selectedId) - Number(left.key === selectedId);
  const hosts = world.hosts.map(
    (host, displayOrder): OfficeHost => ({
      key: host.id,
      displayLabel: host.label,
      accessibleLabel: host.label,
      displayOrder,
      connectionState: host.hostState,
      observed: host.connection.snapshot !== null,
      stale: host.stale || host.hostState === "offline-stale",
      compatibleWithWorld:
        host.hostState === "active" || host.hostState === "ready-inactive",
      compatibleWithSpaces: host.actionable,
      selected: selection
        ? host.connectionId === selection.connectionId
        : host.selectedHost,
      deterministicSkin: {
        themeIndex: stableNumber(host.id) % 6,
        badge: `HOST ${String(displayOrder + 1).padStart(2, "0")}`,
      },
    }),
  );
  const hostById = new Map(hosts.map((host) => [host.key, host]));
  const allRooms = world.spaces
    .map((space) => projectRoom(space, hostById.get(space.parentId)!))
    .sort(compareRooms);
  const roomCandidates = [...allRooms].sort(
    (left, right) =>
      Number(right.source.id === selectedSpaceId) -
        Number(left.source.id === selectedSpaceId) || compareRooms(left, right),
  );
  // Complete room membership and placement are independent of selection.
  const presentedRooms = [...allRooms];
  const presentedRoomKeys = new Set(presentedRooms.map(({ room }) => room.key));
  const prepared = preparedOffice.get(world);
  const allAgents =
    prepared?.agents ?? allRooms.flatMap(({ agents }) => agents);
  const selectedAgent =
    selectedId && prepared
      ? prepared.roster[prepared.agentIndex.get(selectedId) ?? -1]?.agent
      : undefined;
  const rooms = presentedRooms.map((entry) => presentRoom(entry, selectedId));
  yield;
  const roomByKey = new Map(rooms.map((room) => [room.key, room]));
  const receptions = hosts.map((host): OfficeReception => {
    const waitingAgents = (
      prepared
        ? priorityCandidates(
            prepared.waiting.get(host.key) ?? [],
            selectedAgent?.hostKey === host.key &&
              selectedAgent.destination === "reception"
              ? selectedAgent
              : undefined,
          )
        : allAgents
    )
      .filter(
        (agent) =>
          agent.hostKey === host.key && agent.destination === "reception",
      )
      .sort(
        (left, right) =>
          selectedFirst(left, right) || compareAgents(left, right),
      );
    const observedWaitingAgentCount = (() => {
      const status = world.hosts.find(({ id }) => id === host.key)?.coverage
        .status;
      return status ? status.blocked + status.done : waitingAgents.length;
    })();
    return {
      key: `reception:${host.key}`,
      hostKey: host.key,
      hostLabel: host.displayLabel,
      stale: host.stale,
      waitingAgents: waitingAgents.slice(
        0,
        OFFICE_PRESENTATION_BOUNDS.waitingAgentsPerReception,
      ),
      observedWaitingAgentCount,
      overflowCount: Math.max(
        0,
        observedWaitingAgentCount -
          Math.min(
            waitingAgents.length,
            OFFICE_PRESENTATION_BOUNDS.waitingAgentsPerReception,
          ),
      ),
    };
  });
  const barAgents = boundedSorted(
    preparedBarAgents.has(world)
      ? priorityCandidates(
          preparedBarAgents.get(world)!,
          selectedAgent?.destination === "bar" ? selectedAgent : undefined,
        )
      : allAgents.filter(({ destination }) => destination === "bar"),
    OFFICE_PRESENTATION_BOUNDS.barAgents,
    (left, right) =>
      selectedFirst(left, right) || compareBarAgents(left, right),
  );
  const presentedRoomAgentKeys = new Set(
    rooms.flatMap(({ roomAgents }) => roomAgents.map(({ key }) => key)),
  );
  const presentedWaitingKeys = new Set(
    receptions.flatMap(({ waitingAgents }) =>
      waitingAgents.map(({ key }) => key),
    ),
  );
  const presentedBarKeys = new Set(barAgents.map(({ key }) => key));
  const roomRoster = allRooms.map(
    ({ host, room }): OfficeRoomRosterEntry => ({
      key: room.key,
      hostKey: host.key,
      hostLabel: host.displayLabel,
      workspaceRef: room.workspaceRef,
      observedGeneration: room.observedGeneration,
      displayLabel: room.displayLabel,
      order: room.order,
      stale: room.stale,
      canOpenInSpaces: room.canOpenInSpaces,
      presented: presentedRoomKeys.has(room.key),
    }),
  );
  const deskRoster = prepared
    ? prepared.desks.slice()
    : roomCandidates.flatMap((entry) => canonicalRoomRoster(entry).desks);
  const roster = prepared
    ? prepared.roster.slice()
    : roomCandidates.flatMap((entry) => canonicalRoomRoster(entry).agents);
  const paneRoster = prepared
    ? prepared.panes.slice()
    : roomCandidates.flatMap((entry) => canonicalRoomRoster(entry).panes);
  const agentIndex =
    prepared?.agentIndex ??
    new Map(roster.map((entry, index) => [entry.agent.key, index]));
  const deskIndex =
    prepared?.deskIndex ??
    new Map(deskRoster.map((entry, index) => [entry.desk.key, index]));
  const paneIndex =
    prepared?.paneIndex ??
    new Map(paneRoster.map((entry, index) => [entry.device.key, index]));
  let admittedRooms = 0;
  for (const entry of presentedRooms) {
    if (++admittedRooms % 32 === 0) yield;
    const room = roomByKey.get(entry.room.key)!;
    const canonical = canonicalRoomRoster(entry);
    const deskKeys = new Set(room.desks.map((desk) => desk.key));
    const paneKeys = new Set(
      room.desks.flatMap((desk) =>
        desk.paneDevices.map((device) => device.key),
      ),
    );
    const agentsByKey = new Map(
      room.roomAgents.map((agent) => [agent.key, agent]),
    );
    for (const value of canonical.desks)
      deskRoster[deskIndex.get(value.desk.key)!] = {
        ...value,
        presented: deskKeys.has(value.desk.key),
      };
    for (const value of canonical.panes)
      paneRoster[paneIndex.get(value.device.key)!] = {
        ...value,
        presented: paneKeys.has(value.device.key),
      };
    for (const value of canonical.agents) {
      const agent = value.agent;
      roster[agentIndex.get(agent.key)!] = {
        ...value,
        agent: agentsByKey.get(agent.key) ?? agent,
        roomPresented: true,
        deskPresented: !!agent.deskKey && deskKeys.has(agent.deskKey),
        destinationPresented:
          presentedRoomAgentKeys.has(agent.key) ||
          presentedWaitingKeys.has(agent.key) ||
          presentedBarKeys.has(agent.key),
      };
    }
  }
  for (const agent of [
    ...barAgents,
    ...receptions.flatMap((reception) => reception.waitingAgents),
  ]) {
    const index = agentIndex.get(agent.key)!;
    roster[index] = { ...roster[index]!, destinationPresented: true };
  }
  yield;
  const totalRoomAgents =
    world.coverage.status.working + world.coverage.status.unknown;
  const totalWaitingAgents =
    world.coverage.status.blocked + world.coverage.status.done;
  const totalBarAgents = world.coverage.status.idle;
  const renderedRoomAgents = rooms.reduce(
    (count, room) => count + room.roomAgents.length,
    0,
  );
  const renderedWaitingAgents = receptions.reduce(
    (count, reception) => count + reception.waitingAgents.length,
    0,
  );
  const omittedRooms = Math.max(0, world.coverage.spaces - rooms.length);
  const renderedDesks = rooms.reduce(
    (count, room) => count + room.desks.length,
    0,
  );
  const result: HerdrOfficeProjection = {
    version: 1,
    generatedAt,
    hosts,
    rooms,
    receptions,
    barAgents,
    roomRoster,
    deskRoster: prioritizeRoomRoster(
      deskRoster,
      prepared?.ranges.get(selectedSpaceId ?? "")?.desks,
    ),
    paneRoster: prioritizeRoomRoster(
      paneRoster,
      prepared?.ranges.get(selectedSpaceId ?? "")?.panes,
    ),
    roster: prioritizeRoomRoster(
      roster,
      prepared?.ranges.get(selectedSpaceId ?? "")?.agents,
    ),
    unresolved: omittedRooms
      ? [{ kind: "room-bound", count: omittedRooms }]
      : [],
    coverage: {
      configuredHosts: hosts.length,
      observedHosts: hosts.filter(({ observed }) => observed).length,
      compatibleHosts: hosts.filter(({ compatibleWithWorld }) =>
        Boolean(compatibleWithWorld),
      ).length,
      connectingHosts: hosts.filter(
        ({ connectionState }) => connectionState === "reconnecting",
      ).length,
      staleHosts: hosts.filter(({ stale }) => stale).length,
      observedWorkspaces: world.coverage.spaces,
      observedDesks: world.coverage.tabs,
      observedAgents: world.coverage.agents,
      status: { ...world.coverage.status },
      omittedRooms,
      omittedDesks: Math.max(0, world.coverage.tabs - renderedDesks),
      omittedRoomAgents: Math.max(0, totalRoomAgents - renderedRoomAgents),
      omittedReceptionDesks: Math.max(0, hosts.length - receptions.length),
      omittedWaitingAgents: Math.max(
        0,
        totalWaitingAgents - renderedWaitingAgents,
      ),
      omittedBarAgents: Math.max(0, totalBarAgents - barAgents.length),
    },
    presentationBounds: {
      ...OFFICE_PRESENTATION_BOUNDS,
      totalRooms: world.coverage.spaces,
      renderedRooms: rooms.length,
      totalDesks: world.coverage.tabs,
      renderedDesks,
      totalRoomAgents,
      renderedRoomAgents,
      totalReceptionDesks: hosts.length,
      renderedReceptionDesks: receptions.length,
      totalWaitingAgents,
      renderedWaitingAgents,
      totalBarAgents,
      renderedBarAgents: barAgents.length,
    },
  };
  projectionInputs.set(result, {
    allRooms,
    deskRoster,
    paneRoster,
    roster,
    prepared,
  });
  return result;
}

const canonicalRosters = new WeakMap<
  WorldSpaceObject,
  {
    agents: OfficeRosterEntry[];
    desks: OfficeDeskRosterEntry[];
    panes: OfficePaneRosterEntry[];
  }
>();
function canonicalRoomRoster(entry: ProjectedRoom) {
  const previous = canonicalRosters.get(entry.source);
  if (previous) return previous;
  const { host, room, desks, agents, source } = entry;
  const roster = {
    agents: agents.map((agent) => ({
      agent,
      roomKey: room.key,
      roomLabel: room.displayLabel,
      hostKey: host.key,
      hostLabel: host.displayLabel,
      roomPresented: false,
      deskPresented: false,
      destinationPresented: false,
    })),
    desks: desks.map((desk) => ({
      desk,
      roomLabel: room.displayLabel,
      hostLabel: host.displayLabel,
      presented: false,
    })),
    panes: desks.flatMap((desk) =>
      projectPaneDevices(source.children, desk).map((device) => ({
        device,
        roomLabel: room.displayLabel,
        deskLabel: desk.displayLabel,
        hostLabel: host.displayLabel,
        presented: false,
      })),
    ),
  };
  canonicalRosters.set(source, roster);
  return roster;
}
type PreparedOffice = {
  agents: OfficeAgent[];
  ranges: Map<
    string,
    {
      agents: [number, number];
      desks: [number, number];
      panes: [number, number];
    }
  >;
  roster: OfficeRosterEntry[];
  desks: OfficeDeskRosterEntry[];
  panes: OfficePaneRosterEntry[];
  agentIndex: Map<string, number>;
  deskIndex: Map<string, number>;
  paneIndex: Map<string, number>;
  terminalPresentationKeys: Map<string, string>;
  waiting: Map<string, OfficeAgent[]>;
};
const preparedOffice = new WeakMap<WorldObject, PreparedOffice>();
/** Prepared alongside the complete roster, outside React's synchronous render. */
export function preparedOfficePresentationKey(
  projection: HerdrOfficeProjection,
  key: string,
): string | undefined {
  const prepared = projectionInputs.get(projection)?.prepared;
  if (!prepared) return undefined;
  if (
    prepared.agentIndex.has(key) ||
    prepared.deskIndex.has(key) ||
    prepared.paneIndex.has(key) ||
    projection.roomRoster.some((room) => room.key === key) ||
    projection.hosts.some((host) => host.key === key)
  )
    return key;
  return prepared.terminalPresentationKeys.get(key) ?? key;
}

function prioritizeRoomRoster<T>(
  items: T[],
  range: [number, number] | undefined,
): T[] {
  if (!range || range[0] === 0 || range[0] === range[1]) return items;
  return [
    ...items.slice(range[0], range[1]),
    ...items.slice(0, range[0]),
    ...items.slice(range[1]),
  ];
}
function priorityCandidates(
  top: OfficeAgent[],
  selected: OfficeAgent | undefined,
) {
  return selected && !top.some((agent) => agent.key === selected.key)
    ? [...top, selected]
    : top;
}
const preparedBarAgents = new WeakMap<WorldObject, OfficeAgent[]>();

const preparedRooms = new WeakMap<WorldSpaceObject, ProjectedRoom>();

export async function prepareWorldOffice(
  world: WorldObject,
  isCurrent: () => boolean = () => true,
  yieldTask: () => Promise<void> = yieldWorldTask,
): Promise<void> {
  const hosts = new Map(
    world.hosts.map((host, displayOrder): [string, OfficeHost] => [
      host.id,
      {
        key: host.id,
        displayLabel: host.label,
        accessibleLabel: host.label,
        displayOrder,
        connectionState: host.hostState,
        observed: host.connection.snapshot !== null,
        stale: host.stale || host.hostState === "offline-stale",
        compatibleWithWorld:
          host.hostState === "active" || host.hostState === "ready-inactive",
        compatibleWithSpaces: host.actionable,
        selected: host.selectedHost,
        deterministicSkin: {
          themeIndex: stableNumber(host.id) % 6,
          badge: `HOST ${String(displayOrder + 1).padStart(2, "0")}`,
        },
      },
    ]),
  );
  const observation: PreparedOffice = {
    agents: [],
    ranges: new Map(),
    roster: [],
    desks: [],
    panes: [],
    agentIndex: new Map(),
    deskIndex: new Map(),
    paneIndex: new Map(),
    terminalPresentationKeys: new Map(),
    waiting: new Map(),
  };
  const orderedSpaces = [...world.spaces].sort(
    (left, right) =>
      hosts.get(left.parentId)!.displayOrder -
        hosts.get(right.parentId)!.displayOrder ||
      left.workspace.number - right.workspace.number ||
      left.id.localeCompare(right.id),
  );
  let bar: OfficeAgent[] = [];
  for (let index = 0; index < orderedSpaces.length; index++) {
    if (!isCurrent()) return;
    const space = orderedSpaces[index]!;
    const room = buildRoom(space, hosts.get(space.parentId)!);
    preparedRooms.set(space, room);
    presentRoom(room, null);
    const canonical = canonicalRoomRoster(room);
    const range = {
      agents: [observation.roster.length, 0] as [number, number],
      desks: [observation.desks.length, 0] as [number, number],
      panes: [observation.panes.length, 0] as [number, number],
    };
    for (const entry of canonical.agents) {
      observation.agentIndex.set(entry.agent.key, observation.roster.length);
      observation.roster.push(entry);
      observation.agents.push(entry.agent);
    }
    for (const entry of canonical.desks) {
      observation.deskIndex.set(entry.desk.key, observation.desks.length);
      observation.desks.push(entry);
      for (const key of entry.desk.terminalSelectionKeys)
        if (!observation.terminalPresentationKeys.has(key))
          observation.terminalPresentationKeys.set(key, entry.desk.key);
    }
    for (const entry of canonical.panes) {
      observation.paneIndex.set(entry.device.key, observation.panes.length);
      observation.panes.push(entry);
      observation.terminalPresentationKeys.set(
        entry.device.nodeId,
        entry.device.key,
      );
    }
    range.agents[1] = observation.roster.length;
    range.desks[1] = observation.desks.length;
    range.panes[1] = observation.panes.length;
    observation.ranges.set(room.room.key, range);
    observation.waiting.set(
      room.host.key,
      boundedSorted(
        [
          ...(observation.waiting.get(room.host.key) ?? []),
          ...room.agents.filter((agent) => agent.destination === "reception"),
        ],
        OFFICE_PRESENTATION_BOUNDS.waitingAgentsPerReception,
        compareAgents,
      ),
    );
    bar = boundedSorted(
      [...bar, ...room.agents.filter((agent) => agent.destination === "bar")],
      OFFICE_PRESENTATION_BOUNDS.barAgents,
      compareBarAgents,
    );
    if (index % 32 === 31) await yieldTask();
  }
  if (isCurrent()) {
    preparedBarAgents.set(world, bar);
    preparedOffice.set(world, observation);
    await yieldTask();
    const steps = projectWorldOfficeSteps(world, Date.now(), null);
    let step = steps.next();
    while (!step.done) {
      await yieldTask();
      if (!isCurrent()) return;
      step = steps.next();
    }
    if (isCurrent()) preparedProjections.set(world, step.value);
  }
  await yieldTask();
}

function projectRoom(space: WorldSpaceObject, host: OfficeHost): ProjectedRoom {
  const prepared = preparedRooms.get(space);
  return prepared ? { ...prepared, host } : buildRoom(space, host);
}

function buildRoom(space: WorldSpaceObject, host: OfficeHost): ProjectedRoom {
  const operational = space.capabilities.openSpaces;
  const roomKey = space.id;
  const leavesByTab = groupLeavesByTab(space.children);
  const desks = [...space.tabs]
    .sort(
      (left, right) =>
        left.number - right.number || left.tab_id.localeCompare(right.tab_id),
    )
    .map(
      (tab): OfficeDesk => ({
        key: JSON.stringify([space.connectionId, "tab", tab.tab_id]),
        hostKey: host.key,
        roomKey,
        tabRef: target(space, "tab", tab.tab_id),
        terminalSelectionKeys: (leavesByTab.get(tab.tab_id) ?? [])
          .map(({ id }) => id)
          .sort(),
        observedGeneration: space.generation,
        displayLabel:
          boundedOptionalText(tab.label, 100) ?? `Tab ${tab.number}`,
        order: tab.number,
        stale: space.stale,
        canOpenInSpaces: operational,
        completionAgentKeys: [],
        paneDevices: [],
        observedPaneCount: Math.max(
          tab.pane_count,
          (leavesByTab.get(tab.tab_id) ?? []).length,
        ),
        omittedPaneCount: 0,
      }),
    );
  const deskKeys = new Map(
    desks.map((desk) => [desk.tabRef.nativeId, desk.key]),
  );
  const agents = space.children
    .filter((leaf): leaf is WorldLeafObject & { kind: "agent" } =>
      Boolean(leaf.kind === "agent"),
    )
    .map((leaf) => projectAgent(leaf, roomKey, host.key, deskKeys))
    .sort(compareAgents);
  const agentsByDesk = new Map<string, OfficeAgent[]>();
  for (const agent of agents) {
    if (!agent.deskKey) continue;
    const group = agentsByDesk.get(agent.deskKey) ?? [];
    group.push(agent);
    agentsByDesk.set(agent.deskKey, group);
  }
  for (const desk of desks) {
    const deskAgents = agentsByDesk.get(desk.key) ?? [];
    desk.paneDevices = projectPaneDevices(space.children, desk).slice(
      0,
      OFFICE_PRESENTATION_BOUNDS.paneDevicesPerDesk,
    );
    desk.omittedPaneCount = Math.max(
      0,
      desk.observedPaneCount - desk.paneDevices.length,
    );
    const candidates = deskAgents
      .filter((agent) => agent.destination === "room")
      .sort(compareDeskCandidates);
    if (candidates[0]) desk.occupantAgentKey = candidates[0].key;
    desk.completionAgentKeys = deskAgents
      .filter((agent) => agent.semanticStatus === "done")
      .map(({ key }) => key)
      .sort();
  }
  return {
    host,
    source: space,
    room: {
      key: roomKey,
      hostKey: host.key,
      workspaceRef: target(space, "workspace", space.nativeId),
      observedGeneration: space.generation,
      displayLabel: space.label,
      accessibleLabel: space.label,
      order: space.workspace.number,
      stale: space.stale,
      canOpenInSpaces: operational,
    },
    desks,
    agents,
  };
}

const leafGroups = new WeakMap<
  readonly WorldLeafObject[],
  Map<string, WorldLeafObject[]>
>();
function groupLeavesByTab(leaves: readonly WorldLeafObject[]) {
  let groups = leafGroups.get(leaves);
  if (groups) return groups;
  groups = new Map();
  for (const leaf of leaves) {
    const group = groups.get(leaf.tabId) ?? [];
    group.push(leaf);
    groups.set(leaf.tabId, group);
  }
  leafGroups.set(leaves, groups);
  return groups;
}

const preparedPaneDevices = new WeakMap<OfficeDesk, OfficePaneDevice[]>();
function projectPaneDevices(
  leaves: readonly WorldLeafObject[],
  desk: OfficeDesk,
): OfficePaneDevice[] {
  const previous = preparedPaneDevices.get(desk);
  if (previous) return previous;
  const devices = [
    ...(groupLeavesByTab(leaves).get(desk.tabRef.nativeId) ?? []),
  ]
    .sort((left, right) => left.nativeId.localeCompare(right.nativeId))
    .map((leaf, order) => ({
      key: JSON.stringify([
        leaf.connectionId,
        leaf.generation,
        "pane-device",
        leaf.nativeId,
      ]),
      nodeId: leaf.id,
      paneRef: target(leaf, "pane", leaf.nativeId),
      terminalRef: target(leaf, "terminal", leaf.terminalId),
      deskKey: desk.key,
      hostKey: desk.hostKey,
      roomKey: desk.roomKey,
      displayLabel: `Pane ${order + 1}${leaf.agentLabel ? ` · ${leaf.agentLabel}` : ""}`,
      order,
      stale: leaf.stale,
      canOpenInSpaces: leaf.capabilities.openSpaces,
      ...(leaf.kind === "agent" ? { agentKey: leaf.id } : {}),
    }));
  preparedPaneDevices.set(desk, devices);
  return devices;
}

function projectAgent(
  leaf: WorldLeafObject & { kind: "agent" },
  roomKey: string,
  hostKey: string,
  deskKeys: ReadonlyMap<string, string>,
): OfficeAgent {
  const destination = statusDestination(leaf.status);
  const summary = leaf.taskSummary?.slice(0, 160);
  return {
    key: leaf.id,
    nodeId: leaf.id,
    currentPaneRef: target(leaf, "pane", leaf.nativeId),
    currentTerminalRef: target(leaf, "terminal", leaf.terminalId),
    currentTabRef: target(leaf, "tab", leaf.tabId),
    deskKey: deskKeys.get(leaf.tabId) ?? null,
    observedGeneration: leaf.generation,
    roomKey,
    hostKey,
    displayLabel: leaf.agentLabel ?? leaf.label,
    ...(summary ? { taskSummary: summary } : {}),
    semanticStatus: leaf.status,
    stateLabels: leaf.stateLabels,
    focused: leaf.focused,
    destination,
    placement:
      destination === "room"
        ? "standing"
        : destination === "reception"
          ? "waiting"
          : "bar",
    stale: leaf.stale,
    canOpenInSpaces: leaf.capabilities.openSpaces,
    characterIndex: stableNumber(leaf.id) % 12,
  };
}

function target(
  node: Pick<
    WorldLeafObject | WorldSpaceObject,
    "connectionId" | "generation" | "id"
  >,
  kind: OfficeQualifiedTarget["kind"],
  nativeId: string,
): OfficeQualifiedTarget {
  return {
    connectionId: node.connectionId,
    generation: node.generation,
    kind,
    nativeId,
    worldId: node.id,
  };
}

function statusDestination(status: WorldAgentStatus): OfficeAgentDestination {
  if (status === "working" || status === "unknown") return "room";
  return status === "blocked" || status === "done" ? "reception" : "bar";
}

function compareRooms(left: ProjectedRoom, right: ProjectedRoom) {
  return (
    left.host.displayOrder - right.host.displayOrder ||
    left.source.workspace.number - right.source.workspace.number ||
    left.room.key.localeCompare(right.room.key)
  );
}

function boundedSorted<T>(
  values: readonly T[],
  limit: number,
  compare: (left: T, right: T) => number,
): T[] {
  const kept: T[] = [];
  for (const value of values) {
    if (kept.length === limit && compare(value, kept[limit - 1]!) >= 0)
      continue;
    let low = 0,
      high = kept.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (compare(value, kept[middle]!) < 0) high = middle;
      else low = middle + 1;
    }
    kept.splice(low, 0, value);
    if (kept.length > limit) kept.pop();
  }
  return kept;
}

function boundedWithPriority<T>(
  values: readonly T[],
  limit: number,
  priority: (value: T) => boolean,
) {
  if (values.length <= limit) return [...values];
  const admitted = new Set(
    [
      ...values.filter(priority),
      ...values.filter((value) => !priority(value)),
    ].slice(0, limit),
  );
  return values.filter((value) => admitted.has(value));
}

function compareAgents(left: OfficeAgent, right: OfficeAgent) {
  return left.key.localeCompare(right.key);
}

function compareDeskCandidates(left: OfficeAgent, right: OfficeAgent) {
  return (
    roomStatusOrder(left.semanticStatus) -
      roomStatusOrder(right.semanticStatus) ||
    Number(right.focused) - Number(left.focused) ||
    left.key.localeCompare(right.key)
  );
}

function compareRoomAgents(
  left: OfficeAgent,
  right: OfficeAgent,
  order: ReadonlyMap<string, number>,
) {
  return (
    Number(left.placement !== "seated") -
      Number(right.placement !== "seated") ||
    (order.get(left.deskKey ?? "") ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.deskKey ?? "") ?? Number.MAX_SAFE_INTEGER) ||
    compareDeskCandidates(left, right)
  );
}

function compareBarAgents(left: OfficeAgent, right: OfficeAgent) {
  const rank = (status: WorldAgentStatus) =>
    status === "idle" ? 0 : status === "done" ? 1 : 2;
  return (
    rank(left.semanticStatus) - rank(right.semanticStatus) ||
    left.key.localeCompare(right.key)
  );
}

function roomStatusOrder(status: WorldAgentStatus) {
  return status === "working" ? 0 : status === "unknown" ? 1 : 2;
}

function stableNumber(value: string) {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
