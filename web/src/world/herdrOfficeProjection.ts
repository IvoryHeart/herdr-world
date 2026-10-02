import type {
  WorldAgentStatus,
  WorldHostState,
  WorldLeafObject,
  WorldObject,
  WorldSpaceObject,
} from "./worldObject";
import { boundedOptionalText, yieldWorldTask } from "./worldObject";

export const OFFICE_PRESENTATION_BOUNDS = Object.freeze({
  rooms: 128,
  desksPerRoom: 8,
  roomAgentsPerRoom: 16,
  receptionDesks: 6,
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

export function projectWorldOffice(
  world: WorldObject,
  generatedAt: number,
  selectedId: string | null = null,
): HerdrOfficeProjection {
  const selection = selectedId ? world.nodeById.get(selectedId) : undefined;
  const selectedSpaceId =
    selection?.kind === "space" ? selection.id : selection?.parentId;
  const selectedLeaf =
    selection?.kind === "agent" || selection?.kind === "terminal"
      ? selection
      : undefined;
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
    .sort(
      (left, right) =>
        Number(right.source.id === selectedSpaceId) -
          Number(left.source.id === selectedSpaceId) ||
        compareRooms(left, right),
    );
  const presentedRooms = boundedWithPriority(
    allRooms,
    OFFICE_PRESENTATION_BOUNDS.rooms,
    ({ host }) => host.selected,
  );
  const presentedRoomKeys = new Set(presentedRooms.map(({ room }) => room.key));
  const prepared = preparedOffice.get(world);
  const allAgents =
    prepared?.agents ?? allRooms.flatMap(({ agents }) => agents);
  const selectedAgent =
    selectedId && prepared
      ? prepared.roster[prepared.agentIndex.get(selectedId) ?? -1]?.agent
      : undefined;
  const rooms = presentedRooms.map((entry) => {
    const desks = [...entry.desks]
      .sort(
        (left, right) =>
          Number(right.tabRef.nativeId === selectedLeaf?.tabId) -
          Number(left.tabRef.nativeId === selectedLeaf?.tabId),
      )
      .slice(0, OFFICE_PRESENTATION_BOUNDS.desksPerRoom)
      .map((desk) => {
        const devices = projectPaneDevices(entry.source.children, desk)
          .sort(
            (left, right) =>
              Number(right.nodeId === selectedId) -
              Number(left.nodeId === selectedId),
          )
          .slice(0, OFFICE_PRESENTATION_BOUNDS.paneDevicesPerDesk);
        return {
          ...desk,
          paneDevices: devices,
          omittedPaneCount: Math.max(
            0,
            desk.observedPaneCount - devices.length,
          ),
        };
      });
    const seated = new Set(
      desks.flatMap(({ occupantAgentKey }) =>
        occupantAgentKey ? [occupantAgentKey] : [],
      ),
    );
    const roomAgents = entry.agents
      .filter(({ destination }) => destination === "room")
      .map((agent) => ({
        ...agent,
        placement: seated.has(agent.key)
          ? ("seated" as const)
          : ("standing" as const),
      }))
      .sort(
        (left, right) =>
          selectedFirst(left, right) || compareRoomAgents(left, right, desks),
      );
    return {
      ...entry.room,
      desks,
      roomAgents: roomAgents.slice(
        0,
        OFFICE_PRESENTATION_BOUNDS.roomAgentsPerRoom,
      ),
      omittedDeskCount: Math.max(0, entry.source.coverage.tabs - desks.length),
      omittedAgentCount: Math.max(
        0,
        entry.source.coverage.status.working +
          entry.source.coverage.status.unknown -
          Math.min(
            roomAgents.length,
            OFFICE_PRESENTATION_BOUNDS.roomAgentsPerRoom,
          ),
      ),
      observedDeskCount: entry.source.coverage.tabs,
      observedAgentCount: entry.source.coverage.agents,
    };
  });
  const roomByKey = new Map(rooms.map((room) => [room.key, room]));
  const receptions = boundedWithPriority(
    hosts,
    OFFICE_PRESENTATION_BOUNDS.receptionDesks,
    ({ selected }) => selected,
  ).map((host): OfficeReception => {
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
    : allRooms.flatMap((entry) => canonicalRoomRoster(entry).desks);
  const roster = prepared
    ? prepared.roster.slice()
    : allRooms.flatMap((entry) => canonicalRoomRoster(entry).agents);
  const paneRoster = prepared
    ? prepared.panes.slice()
    : allRooms.flatMap((entry) => canonicalRoomRoster(entry).panes);
  const agentIndex =
    prepared?.agentIndex ??
    new Map(roster.map((entry, index) => [entry.agent.key, index]));
  const deskIndex =
    prepared?.deskIndex ??
    new Map(deskRoster.map((entry, index) => [entry.desk.key, index]));
  const paneIndex =
    prepared?.paneIndex ??
    new Map(paneRoster.map((entry, index) => [entry.device.key, index]));
  for (const entry of presentedRooms) {
    const room = roomByKey.get(entry.room.key)!;
    const canonical = canonicalRoomRoster(entry);
    for (const value of canonical.desks)
      deskRoster[deskIndex.get(value.desk.key)!] = {
        ...value,
        presented: room.desks.some((desk) => desk.key === value.desk.key),
      };
    for (const value of canonical.panes)
      paneRoster[paneIndex.get(value.device.key)!] = {
        ...value,
        presented: room.desks.some((desk) =>
          desk.paneDevices.some((device) => device.key === value.device.key),
        ),
      };
    for (const value of canonical.agents) {
      const agent = value.agent;
      roster[agentIndex.get(agent.key)!] = {
        ...value,
        agent: room.roomAgents.find(({ key }) => key === agent.key) ?? agent,
        roomPresented: true,
        deskPresented:
          !!agent.deskKey &&
          room.desks.some(({ key }) => key === agent.deskKey),
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
  return {
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
      omittedReceptionDesks: Math.max(
        0,
        hosts.length - OFFICE_PRESENTATION_BOUNDS.receptionDesks,
      ),
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
  waiting: Map<string, OfficeAgent[]>;
};
const preparedOffice = new WeakMap<WorldObject, PreparedOffice>();
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
    }
    for (const entry of canonical.panes) {
      observation.paneIndex.set(entry.device.key, observation.panes.length);
      observation.panes.push(entry);
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
    if (index % 32 === 31) await yieldWorldTask();
  }
  if (isCurrent()) {
    preparedBarAgents.set(world, bar);
    preparedOffice.set(world, observation);
  }
  await yieldWorldTask();
}

function projectRoom(space: WorldSpaceObject, host: OfficeHost): ProjectedRoom {
  const prepared = preparedRooms.get(space);
  return prepared ? { ...prepared, host } : buildRoom(space, host);
}

function buildRoom(space: WorldSpaceObject, host: OfficeHost): ProjectedRoom {
  const operational = space.capabilities.openSpaces;
  const roomKey = space.id;
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
        terminalSelectionKeys: space.children
          .filter(({ tabId }) => tabId === tab.tab_id)
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
          space.children.filter(({ tabId }) => tabId === tab.tab_id).length,
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
  for (const desk of desks) {
    desk.paneDevices = projectPaneDevices(space.children, desk).slice(
      0,
      OFFICE_PRESENTATION_BOUNDS.paneDevicesPerDesk,
    );
    desk.omittedPaneCount = Math.max(
      0,
      desk.observedPaneCount - desk.paneDevices.length,
    );
    const candidates = agents
      .filter(
        (agent) => agent.destination === "room" && agent.deskKey === desk.key,
      )
      .sort(compareDeskCandidates);
    if (candidates[0]) desk.occupantAgentKey = candidates[0].key;
    desk.completionAgentKeys = agents
      .filter(
        (agent) =>
          agent.semanticStatus === "done" && agent.deskKey === desk.key,
      )
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

function projectPaneDevices(
  leaves: readonly WorldLeafObject[],
  desk: OfficeDesk,
): OfficePaneDevice[] {
  return leaves
    .filter(({ tabId }) => tabId === desk.tabRef.nativeId)
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
  desks: readonly OfficeDesk[],
) {
  const order = new Map(desks.map((desk, index) => [desk.key, index]));
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
