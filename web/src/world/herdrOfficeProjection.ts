import type { OfficeHost } from "./officeHost";
export type { OfficeHost } from "./officeHost";
import type {
  OfficeAgent,
  OfficeCoverage,
  OfficeDesk,
  OfficeDeskRosterEntry,
  OfficePaneRosterEntry,
  OfficeReception,
  OfficeRoom,
  OfficeRoomRosterEntry,
  OfficeRosterEntry,
} from "./officeProjectionTypes";
export type {
  OfficeAgent,
  OfficeAgentDestination,
  OfficeAgentPlacement,
  OfficeCoverage,
  OfficeDesk,
  OfficeDeskRosterEntry,
  OfficePaneDevice,
  OfficePaneRosterEntry,
  OfficeQualifiedTarget,
  OfficeReception,
  OfficeRoom,
  OfficeRoomRosterEntry,
  OfficeRosterEntry,
} from "./officeProjectionTypes";
import type {
  WorldAgentStatus,
  WorldObject,
  WorldSpaceObject,
} from "./worldObject";
import {
  boundedDesks,
  boundedWithPriority,
  boundedSorted,
  prioritizeRoomRoster,
  priorityCandidates,
} from "./officeDesks";
import {
  createOfficeReadModel,
  setOfficeReadModel,
  withOfficeReadModel,
} from "./officeReadModel";
import { stableNumber } from "./stableNumber";
import { yieldWorldTask } from "./worldObject";
import { tabCardKey } from "../../../shared/terminalColor";
import {
  buildRoom,
  compareAgents,
  compareDeskCandidates,
  constructRoom,
  projectPaneDevices,
  type ProjectedRoom,
} from "./officeRoom";

export const OFFICE_PRESENTATION_BOUNDS = Object.freeze({
  rooms: 128,
  desksPerRoom: 8,
  /** Desks a room shows until it is expanded (Town); Office never folds. */
  foldedDesksPerRoom: 8,
  roomAgentsPerRoom: 16,
  receptionDesks: 6,
  waitingAgentsPerReception: 8,
  paneDevicesPerDesk: 4,
  barAgents: 16,
  rosterPage: 50,
});

export type OfficePresentationBounds = {
  readonly [K in keyof typeof OFFICE_PRESENTATION_BOUNDS]: number;
};

export const TOWN_DESK_EXPANSION_STEP = 20;

/**
 * Town rooms reveal a native-order prefix, expanding by 20 desks per action.
 * Layout grows for every admitted desk; other bounds match Office.
 */
export const TOWN_PRESENTATION_BOUNDS: OfficePresentationBounds = Object.freeze(
  {
    ...OFFICE_PRESENTATION_BOUNDS,
    desksPerRoom: 24 + TOWN_DESK_EXPANSION_STEP,
    foldedDesksPerRoom: 24,
    roomAgentsPerRoom: 127 * 4,
  },
);

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
  presentationBounds: OfficePresentationBounds & {
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

/** Retain immutable topology across selection overlays and equivalent refreshes. */
export function createOfficeProjector(
  bounds: OfficePresentationBounds = OFFICE_PRESENTATION_BOUNDS,
) {
  let previousWorld: WorldObject | null = null;
  let previous: HerdrOfficeProjection | null = null;
  let previousSelected: string | null = null;
  let previousPreferredRoom: string | null = null;
  let previousExpanded: ReadonlySet<string> = NO_EXPANDED_ROOMS;
  let previousPinned: ReadonlySet<string> = NO_PINNED_TABS;
  let previousDeskLimits: ReadonlyMap<string, number> = NO_DESK_LIMITS;
  const intern = <T extends { key: string }>(next: T[], prior: T[]) => {
    const byKey = new Map(prior.map((item) => [item.key, item]));
    const result = next.map((item) => {
      const old = byKey.get(item.key);
      return old && JSON.stringify(old) === JSON.stringify(item) ? old : item;
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
    pinnedTabs: ReadonlySet<string> = NO_PINNED_TABS,
    expandedRooms: ReadonlySet<string> = NO_EXPANDED_ROOMS,
    preferredRoomKey: string | null = null,
    expandedDeskLimits: ReadonlyMap<string, number> = NO_DESK_LIMITS,
  ): HerdrOfficeProjection => {
    let next: HerdrOfficeProjection | null = null;
    const inputs = previous && projectionInputs.get(previous);
    // Cache fold targets and Office pin priorities. Town admission itself
    // remains a native-order prefix regardless of activity or selection.
    const sameAdmission =
      preferredRoomKey === previousPreferredRoom &&
      pinnedTabs === previousPinned &&
      expandedRooms === previousExpanded &&
      expandedDeskLimits.size === previousDeskLimits.size &&
      [...expandedDeskLimits].every(
        ([key, limit]) => previousDeskLimits.get(key) === limit,
      );
    if (
      previous &&
      inputs &&
      previousWorld === world &&
      selectedId === previousSelected &&
      sameAdmission
    ) {
      next = { ...previous, generatedAt };
    } else if (
      previous &&
      previousWorld === world &&
      sameAdmission &&
      inputs?.prepared
    ) {
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
      // Selection can reserve otherwise-omitted desks, panes and agents. Those
      // rooms must run bounded admission again, including when selection clears.
      const boundedAdmissionUnchanged = inputs.allRooms
        .filter(
          (entry) =>
            entry.source.id === selectedSpaceId ||
            entry.source.id === oldSpaceId,
        )
        .every(
          (entry) =>
            entry.desks.length <= bounds.foldedDesksPerRoom &&
            entry.agents.filter((agent) => agent.destination === "room")
              .length <= bounds.roomAgentsPerRoom &&
            entry.desks.every(
              (desk) => desk.observedPaneCount <= bounds.paneDevicesPerDesk,
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
      const selectedHosts = new Set(
        hosts.filter((host) => host.selected).map((host) => host.key),
      );
      const candidates = [...inputs.allRooms].sort(
        (a, b) =>
          Number(b.source.id === selectedSpaceId) -
            Number(a.source.id === selectedSpaceId) || compareRooms(a, b),
      );
      const rooms = boundedWithPriority(
        candidates,
        bounds.rooms,
        (entry) => selectedHosts.has(entry.host.key),
        (entry) =>
          entry.source.id === selectedSpaceId ||
          entry.room.key === preferredRoomKey,
      ).sort(compareRooms);
      const receptions = boundedWithPriority(
        hosts,
        bounds.receptionDesks,
        (host) => host.selected,
      );
      const sameAdmission =
        rooms.length === previous.rooms.length &&
        rooms.every(
          (entry, index) => entry.room.key === previous!.rooms[index]!.key,
        ) &&
        receptions.length === previous.receptions.length &&
        receptions.every(
          (host, index) => host.key === previous!.receptions[index]!.hostKey,
        );
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
      if (
        sameAdmission &&
        inRoom &&
        !previousMovedQueue &&
        boundedAdmissionUnchanged
      ) {
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
    if (next && inputs) {
      projectionInputs.set(next, inputs);
      withOfficeReadModel(previous!, next);
    } else
      next = projectWorldOffice(
        world,
        generatedAt,
        selectedId,
        bounds,
        pinnedTabs,
        expandedRooms,
        preferredRoomKey,
        expandedDeskLimits,
      );
    if (previous && next.rooms !== previous.rooms) {
      // Compare content once at projection admission, never once per canvas frame.
      next.rooms = intern(next.rooms, previous.rooms);
      next.hosts = intern(next.hosts, previous.hosts);
      next.receptions = intern(next.receptions, previous.receptions);
      next.barAgents = intern(next.barAgents, previous.barAgents);
    }
    previousWorld = world;
    previousSelected = selectedId;
    previousPreferredRoom = preferredRoomKey;
    previousExpanded = expandedRooms;
    previousPinned = pinnedTabs;
    previousDeskLimits = new Map(expandedDeskLimits);
    previous = next;
    return next;
  };
}

const NO_PINNED_TABS: ReadonlySet<string> = new Set();
const NO_DESK_LIMITS: ReadonlyMap<string, number> = new Map();

/**
 * `pinnedTabs` holds the tab card keys of Town's pinned desks (useDeskPins.ts):
 * Office reserves bounded capacity for them. Town instead keeps a contiguous
 * prefix; its pin cells apply only while those tabs are admitted.
 */
export function projectWorldOffice(
  world: WorldObject,
  generatedAt: number,
  selectedId: string | null = null,
  bounds: OfficePresentationBounds = OFFICE_PRESENTATION_BOUNDS,
  pinnedTabs: ReadonlySet<string> = NO_PINNED_TABS,
  /** Rooms the user expanded past `foldedDesksPerRoom` (room keys). */
  expandedRooms: ReadonlySet<string> = NO_EXPANDED_ROOMS,
  /** A validated qualified room requested by camera navigation. */
  preferredRoomKey: string | null = null,
  /** Current incremental expansion target for each expanded room. */
  expandedDeskLimits: ReadonlyMap<string, number> = NO_DESK_LIMITS,
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
      connectionId: host.connectionId,
      displayLabel: host.label,
      accessibleLabel: host.label,
      displayOrder,
      connectionState: host.hostState,
      runtimeState: host.connection.state,
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
  // Selection reserves bounded capacity; it does not change room placement.
  const presentedRooms = boundedWithPriority(
    roomCandidates,
    bounds.rooms,
    ({ host }) => host.selected,
    ({ source, room }) =>
      source.id === selectedSpaceId || room.key === preferredRoomKey,
  ).sort(compareRooms);
  const presentedRoomKeys = new Set(presentedRooms.map(({ room }) => room.key));
  const prepared = preparedOffice.get(world);
  const allAgents =
    prepared?.agents ?? allRooms.flatMap(({ agents }) => agents);
  const selectedAgent =
    selectedId && prepared
      ? prepared.roster[prepared.agentIndex.get(selectedId) ?? -1]?.agent
      : undefined;
  const workspaceIds = new Map<string, Set<string>>();
  if (pinnedTabs.size)
    for (const { room } of presentedRooms) {
      const { connectionId, nativeId } = room.workspaceRef;
      if (!workspaceIds.has(connectionId))
        workspaceIds.set(connectionId, new Set());
      workspaceIds.get(connectionId)!.add(nativeId);
    }
  const pinned = (desk: OfficeDesk) =>
    pinnedTabs.size > 0 &&
    pinnedTabs.has(
      tabCardKey(
        desk.tabRef.connectionId,
        desk.tabRef.nativeId,
        workspaceIds.get(desk.tabRef.connectionId) ?? NO_PINNED_TABS,
      ),
    );
  const rooms = presentedRooms.map((entry) => {
    const expanded = expandedRooms.has(entry.room.key);
    const folds = entry.desks.length > bounds.foldedDesksPerRoom;
    const deskRenderLimit = expanded
      ? Math.max(
          bounds.foldedDesksPerRoom + TOWN_DESK_EXPANSION_STEP,
          expandedDeskLimits.get(entry.room.key) ?? bounds.desksPerRoom,
        )
      : bounds.foldedDesksPerRoom;
    const desks = boundedDesks(
      entry.desks,
      entry.agents,
      deskRenderLimit,
      (desk) =>
        entry.source.id === selectedSpaceId &&
        desk.tabRef.nativeId === selectedLeaf?.tabId,
      pinned,
      bounds === TOWN_PRESENTATION_BOUNDS,
    );
    const presentedDesks = desks.map((desk) => {
      const devices = boundedWithPriority(
        projectPaneDevices(entry.source.children, desk),
        bounds.paneDevicesPerDesk,
        (device) => device.nodeId === selectedId,
      );
      return {
        ...desk,
        paneDevices: devices,
        omittedPaneCount: Math.max(0, desk.observedPaneCount - devices.length),
      };
    });
    const seated = new Set(
      presentedDesks.flatMap(({ occupantAgentKey }) =>
        occupantAgentKey ? [occupantAgentKey] : [],
      ),
    );
    const deskOrder = new Map(
      presentedDesks.map((desk, index) => [desk.key, index]),
    );
    // A pinned desk keeps its agents too.
    const pinnedDesks = new Set(
      presentedDesks.filter(pinned).map((desk) => desk.key),
    );
    const keptAgent = (agent: { key: string; deskKey: string | null }) =>
      agent.key === selectedId ||
      (agent.deskKey !== null && pinnedDesks.has(agent.deskKey));
    const roomAgents = entry.agents
      .filter(({ destination }) => destination === "room")
      .map((agent) => ({
        ...agent,
        placement: seated.has(agent.key)
          ? ("seated" as const)
          : ("standing" as const),
      }))
      .sort((left, right) => compareRoomAgents(left, right, deskOrder));
    // Like their desks, the selected and pinned desks' agents stay past the
    // bound.
    const shownAgents = boundedWithPriority(
      roomAgents,
      Math.max(bounds.roomAgentsPerRoom, roomAgents.filter(keptAgent).length),
      keptAgent,
      (agent) => agent.key === selectedId,
    );
    return {
      ...entry.room,
      desks: presentedDesks,
      roomAgents: shownAgents,
      omittedDeskCount: Math.max(
        0,
        entry.source.coverage.tabs - presentedDesks.length,
      ),
      ...(folds || expanded
        ? { deskFold: expanded ? ("expanded" as const) : ("folded" as const) }
        : {}),
      omittedAgentCount: Math.max(
        0,
        entry.source.coverage.status.working +
          entry.source.coverage.status.unknown -
          shownAgents.length,
      ),
      observedDeskCount: entry.source.coverage.tabs,
      observedAgentCount: entry.source.coverage.agents,
      deskRenderLimit,
    };
  });
  const roomByKey = new Map(rooms.map((room) => [room.key, room]));
  const receptions = boundedWithPriority(
    hosts,
    bounds.receptionDesks,
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
      waitingAgents: waitingAgents.slice(0, bounds.waitingAgentsPerReception),
      observedWaitingAgentCount,
      overflowCount: Math.max(
        0,
        observedWaitingAgentCount -
          Math.min(waitingAgents.length, bounds.waitingAgentsPerReception),
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
    bounds.barAgents,
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
      omittedReceptionDesks: Math.max(0, hosts.length - bounds.receptionDesks),
      omittedWaitingAgents: Math.max(
        0,
        totalWaitingAgents - renderedWaitingAgents,
      ),
      omittedBarAgents: Math.max(0, totalBarAgents - barAgents.length),
    },
    presentationBounds: {
      ...bounds,
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
  const read =
    prepared?.readModel ??
    createOfficeReadModel(
      world.hosts,
      (key) => roster[agentIndex.get(key) ?? -1]?.agent,
      (key) => paneRoster[paneIndex.get(key) ?? -1]?.device,
    );
  if (!prepared)
    for (const entry of allRooms)
      read.addRoom(entry.room.key, canonicalRoomRoster(entry).agents);
  setOfficeReadModel(result, read.model);
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
  readModel: ReturnType<typeof createOfficeReadModel>;
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

const preparedBarAgents = new WeakMap<WorldObject, OfficeAgent[]>();

const preparedRooms = new WeakMap<WorldSpaceObject, ProjectedRoom>();

const OFFICE_PREPARATION_SLICE_MS = 6;

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
        connectionId: host.connectionId,
        displayLabel: host.label,
        accessibleLabel: host.label,
        displayOrder,
        connectionState: host.hostState,
        runtimeState: host.connection.state,
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
    readModel: createOfficeReadModel(
      world.hosts,
      (key) => observation.roster[observation.agentIndex.get(key) ?? -1]?.agent,
      (key) => observation.panes[observation.paneIndex.get(key) ?? -1]?.device,
    ),
  };
  const orderedSpaces = [...world.spaces].sort(
    (left, right) =>
      hosts.get(left.parentId)!.displayOrder -
        hosts.get(right.parentId)!.displayOrder ||
      left.workspace.number - right.workspace.number ||
      left.id.localeCompare(right.id),
  );
  let bar: OfficeAgent[] = [];
  // Room cost grows with its desks, so preparation yields on elapsed time.
  let sliceStart = performance.now();
  for (let index = 0; index < orderedSpaces.length; index++) {
    if (!isCurrent()) return;
    const space = orderedSpaces[index]!;
    // A large room is not one indivisible slice: construction yields per
    // pane, desk and agent, and nothing is published until it completes.
    const construction = constructRoom(
      space,
      hosts.get(space.parentId)!,
      OFFICE_PRESENTATION_BOUNDS.paneDevicesPerDesk,
    );
    let step = construction.next();
    while (!step.done) {
      if (performance.now() - sliceStart >= OFFICE_PREPARATION_SLICE_MS) {
        await yieldTask();
        if (!isCurrent()) return;
        sliceStart = performance.now();
      }
      step = construction.next();
    }
    const room = step.value;
    preparedRooms.set(space, room);
    const canonical = canonicalRoomRoster(room);
    observation.readModel.addRoom(room.room.key, canonical.agents);
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
    if (performance.now() - sliceStart >= OFFICE_PREPARATION_SLICE_MS) {
      await yieldTask();
      sliceStart = performance.now();
    }
  }
  if (isCurrent()) {
    preparedBarAgents.set(world, bar);
    preparedOffice.set(world, observation);
  }
  await yieldTask();
}

function projectRoom(space: WorldSpaceObject, host: OfficeHost): ProjectedRoom {
  const prepared = preparedRooms.get(space);
  return prepared
    ? { ...prepared, host }
    : buildRoom(space, host, OFFICE_PRESENTATION_BOUNDS.paneDevicesPerDesk);
}

function compareRooms(left: ProjectedRoom, right: ProjectedRoom) {
  return (
    left.host.displayOrder - right.host.displayOrder ||
    left.source.workspace.number - right.source.workspace.number ||
    left.room.key.localeCompare(right.room.key)
  );
}

const NO_EXPANDED_ROOMS: ReadonlySet<string> = new Set();

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
