/**
 * Town's buildings stand for hosts (#1047). By default a building is one
 * machine, holding the rooms of every runtime World holds there; with the
 * "Town buildings" setting on "One per runtime" (or `?townBuildings=runtime`)
 * each runtime keeps its own building, and a host's buildings stand side by
 * side under "Host · runtime" signs.
 *
 * Pure presentation over the office projection: rooms, desks and agents keep
 * their own runtime targets (connection ID and generation), so every action
 * still reaches the runtime that owns it. Only which building a room stands
 * in, and the building's name, change. A merged building is keyed by its
 * first runtime's host key, which does not depend on runtime state, so rooms
 * do not move between buildings when a runtime drops; building-wide signs
 * (reception filter, answer delivery, expenses) read that runtime.
 *
 * Two profiles of one runtime endpoint (say the startup configuration's
 * "Default" and a saved "local" on the same Herdr socket) report the same
 * workspaces. Town shows that endpoint's rooms once, from one connection:
 * a live one first, then a writable one, then the host's first (#1189). The
 * other connection keeps its identity and stays in Hosts and Integrations.
 */

import type { WorldHostGroup } from "../../hostGroups";
import { runtimeName } from "../../hostGroups";
import type {
  HerdrOfficeProjection,
  OfficeAgent,
  OfficeDesk,
  OfficeHost,
  OfficePaneDevice,
  OfficeReception,
  OfficeRoom,
} from "../herdrOfficeProjection";
import type { TownBuildings } from "../officePreferences";
import { officeReadModel, setOfficeReadModel } from "../officeReadModel";

export type TownBuildingsMode = TownBuildings;

/**
 * The Town buildings setting, unless the page's `?townBuildings=host` or
 * `?townBuildings=runtime` names a layout for comparing the two.
 */
export function townBuildingsMode(
  search: string,
  setting: TownBuildingsMode = "host",
): TownBuildingsMode {
  const flag = new URLSearchParams(search).get("townBuildings");
  return flag === "runtime" || flag === "host" ? flag : setting;
}

type HostGroupShape = Pick<WorldHostGroup, "id" | "label" | "connectionIds"> & {
  runtimes: readonly (Pick<
    WorldHostGroup["runtimes"][number],
    "id" | "runtime"
  > &
    Partial<
      Pick<WorldHostGroup["runtimes"][number], "endpoint" | "readOnly">
    >)[];
};

type Plan = {
  /** Building key by office host key. */
  buildingOf: Map<string, string>;
  /** Each building's host, in town order. */
  hosts: OfficeHost[];
  /** Room order offset by office host key, so a host's runtimes stay apart. */
  orderOffset: Map<string, number>;
  labelOf: Map<string, string>;
  /** Office host keys whose endpoint another connection already shows. */
  hidden: Set<string>;
  signature: string;
};

type EndpointHost = Pick<OfficeHost, "key" | "connectionId" | "stale">;

/**
 * One connection per runtime endpoint: the keys of hosts a better connection
 * to the same endpoint already shows. Town passes these to the office
 * projection before bounded admission, so a duplicate connection's rooms take
 * no room capacity (#1189), and removes them again when it lays buildings out.
 */
export function hiddenEndpointHosts(
  hosts: readonly EndpointHost[],
  groups: readonly HostGroupShape[],
): Set<string> {
  const hidden = new Set<string>();
  for (const group of groups) {
    const runtimeOf = (host: EndpointHost) =>
      group.runtimes.find(({ id }) => id === host.connectionId);
    const better = (a: EndpointHost, b: EndpointHost) =>
      a.stale !== b.stale
        ? !a.stale
        : Boolean(runtimeOf(a)?.readOnly) !== Boolean(runtimeOf(b)?.readOnly)
          ? !runtimeOf(a)?.readOnly
          : false;
    const rank = (host: EndpointHost) =>
      group.connectionIds.indexOf(host.connectionId);
    const members = hosts
      .filter((host) => rank(host) >= 0)
      .sort((a, b) => rank(a) - rank(b));
    const shown = new Map<string, EndpointHost>();
    for (const host of members) {
      const endpoint = runtimeOf(host)?.endpoint;
      if (!endpoint) continue;
      const current = shown.get(endpoint);
      if (!current) shown.set(endpoint, host);
      else if (better(host, current)) {
        hidden.add(current.key);
        shown.set(endpoint, host);
      } else hidden.add(host.key);
    }
  }
  return hidden;
}

/** Rooms of a host's later runtimes follow its first runtime's rooms. */
const RUNTIME_ORDER_STRIDE = 1_000_000;

function plan(
  office: HerdrOfficeProjection,
  groups: readonly HostGroupShape[],
  mode: TownBuildingsMode,
): Plan {
  const hidden = hiddenEndpointHosts(office.hosts, groups);
  const groupOf = new Map<string, HostGroupShape>();
  for (const group of groups)
    for (const id of group.connectionIds) groupOf.set(id, group);
  const present = new Map<string, OfficeHost[]>();
  const order: (HostGroupShape | OfficeHost)[] = [];
  for (const host of office.hosts) {
    if (hidden.has(host.key)) continue;
    const group = groupOf.get(host.connectionId);
    if (!group) {
      order.push(host);
      continue;
    }
    const members = present.get(group.id);
    if (members) members.push(host);
    else {
      present.set(group.id, [host]);
      order.push(group);
    }
  }
  const buildingOf = new Map<string, string>();
  const orderOffset = new Map<string, number>();
  const labelOf = new Map<string, string>();
  const hosts: OfficeHost[] = [];
  const push = (host: OfficeHost) =>
    hosts.push(
      host.displayOrder === hosts.length &&
        host.displayLabel === labelOf.get(host.key)
        ? host
        : {
            ...host,
            displayOrder: hosts.length,
            displayLabel: labelOf.get(host.key)!,
            accessibleLabel: labelOf.get(host.key)!,
          },
    );
  for (const item of order) {
    if (!("connectionIds" in item)) {
      buildingOf.set(item.key, item.key);
      labelOf.set(item.key, item.displayLabel);
      push(item);
      continue;
    }
    const group = item;
    const rank = (host: OfficeHost) =>
      group.connectionIds.indexOf(host.connectionId);
    const members = [...present.get(group.id)!].sort(
      (a, b) => rank(a) - rank(b),
    );
    if (mode === "runtime") {
      for (const host of members) {
        const runtime = group.runtimes.find(
          ({ id }) => id === host.connectionId,
        );
        buildingOf.set(host.key, host.key);
        labelOf.set(
          host.key,
          members.length > 1 && runtime
            ? `${group.label} · ${runtimeName(runtime)}`
            : group.label,
        );
        push(host);
      }
      continue;
    }
    const first = members[0]!;
    members.forEach((host, index) => {
      buildingOf.set(host.key, first.key);
      orderOffset.set(host.key, index * RUNTIME_ORDER_STRIDE);
    });
    labelOf.set(first.key, group.label);
    const live = members.find((host) => !host.stale);
    const merged: OfficeHost = {
      ...first,
      // A building stands while any of its runtimes does; its rooms show
      // their own runtime's staleness.
      stale: !live,
      connectionState: (live ?? first).connectionState,
      runtimeState: (live ?? first).runtimeState,
      observed: members.some((host) => host.observed),
      compatibleWithWorld: members.some((host) => host.compatibleWithWorld),
      selected: members.some((host) => host.selected),
    };
    const unchanged =
      members.length === 1 &&
      merged.stale === first.stale &&
      merged.connectionState === first.connectionState &&
      merged.runtimeState === first.runtimeState;
    push(unchanged ? first : merged);
  }
  const signature = JSON.stringify([
    mode,
    [...buildingOf],
    [...labelOf],
    [...orderOffset],
    [...hidden],
  ]);
  return { buildingOf, hosts, orderOffset, labelOf, hidden, signature };
}

/**
 * Remaps the office's rooms and agents onto host buildings. Keeps object
 * identity for unchanged inputs (and for whole offices when nothing moves),
 * so the town re-lays out only when the office itself changed.
 */
export function createTownBuildings() {
  let signature = "";
  let agents = new WeakMap<OfficeAgent, OfficeAgent>();
  let desks = new WeakMap<OfficeDesk, OfficeDesk>();
  let devices = new WeakMap<OfficePaneDevice, OfficePaneDevice>();
  let rooms = new WeakMap<OfficeRoom, OfficeRoom>();
  let last: {
    office: HerdrOfficeProjection;
    groups: readonly HostGroupShape[];
    mode: TownBuildingsMode;
    result: HerdrOfficeProjection;
  } | null = null;
  return (
    office: HerdrOfficeProjection,
    groups: readonly HostGroupShape[],
    mode: TownBuildingsMode,
  ): HerdrOfficeProjection => {
    if (
      last &&
      last.office === office &&
      last.groups === groups &&
      last.mode === mode
    )
      return last.result;
    const next = plan(office, groups, mode);
    if (next.signature !== signature) {
      signature = next.signature;
      agents = new WeakMap();
      desks = new WeakMap();
      devices = new WeakMap();
      rooms = new WeakMap();
    }
    const result = apply(office, next, { agents, desks, devices, rooms });
    last = { office, groups, mode, result };
    return result;
  };
}

function apply(
  office: HerdrOfficeProjection,
  { buildingOf, hosts, orderOffset, labelOf, hidden }: Plan,
  cache: {
    agents: WeakMap<OfficeAgent, OfficeAgent>;
    desks: WeakMap<OfficeDesk, OfficeDesk>;
    devices: WeakMap<OfficePaneDevice, OfficePaneDevice>;
    rooms: WeakMap<OfficeRoom, OfficeRoom>;
  },
): HerdrOfficeProjection {
  const moved = (hostKey: string) =>
    (buildingOf.get(hostKey) ?? hostKey) !== hostKey;
  const renamed = office.hosts.some(
    (host) => labelOf.get(host.key) !== host.displayLabel,
  );
  if (
    !renamed &&
    !hidden.size &&
    hosts.length === office.hosts.length &&
    hosts.every((host, index) => host === office.hosts[index]) &&
    ![...buildingOf].some(([key]) => moved(key))
  )
    return office;
  const building = (hostKey: string) => buildingOf.get(hostKey) ?? hostKey;
  const label = (hostKey: string, fallback: string) =>
    labelOf.get(building(hostKey)) ?? fallback;
  const memo = <T extends object>(
    map: WeakMap<T, T>,
    item: T,
    make: () => T,
  ) => {
    let mapped = map.get(item);
    if (!mapped) map.set(item, (mapped = make()));
    return mapped;
  };
  const agent = (item: OfficeAgent) =>
    moved(item.hostKey)
      ? memo(cache.agents, item, () => ({
          ...item,
          hostKey: building(item.hostKey),
        }))
      : item;
  const device = (item: OfficePaneDevice) =>
    moved(item.hostKey)
      ? memo(cache.devices, item, () => ({
          ...item,
          hostKey: building(item.hostKey),
        }))
      : item;
  const desk = (item: OfficeDesk) =>
    moved(item.hostKey)
      ? memo(cache.desks, item, () => ({
          ...item,
          hostKey: building(item.hostKey),
          paneDevices: item.paneDevices.map(device),
        }))
      : item;
  const room = (item: OfficeRoom) =>
    moved(item.hostKey)
      ? memo(cache.rooms, item, () => ({
          ...item,
          hostKey: building(item.hostKey),
          order: item.order + (orderOffset.get(item.hostKey) ?? 0),
          desks: item.desks.map(desk),
          roomAgents: item.roomAgents.map(agent),
        }))
      : item;
  const shown = <T>(items: T[], hostKey: (item: T) => string) =>
    hidden.size ? items.filter((item) => !hidden.has(hostKey(item))) : items;
  // One reception per building, its queue the queues of its runtimes.
  const receptions = new Map<string, OfficeReception>();
  for (const reception of shown(office.receptions, (item) => item.hostKey)) {
    const key = building(reception.hostKey);
    const existing = receptions.get(key);
    const waiting = reception.waitingAgents.map(agent);
    if (!existing) {
      receptions.set(key, {
        ...reception,
        key: `reception:${key}`,
        hostKey: key,
        hostLabel: label(reception.hostKey, reception.hostLabel),
        waitingAgents: waiting,
      });
      continue;
    }
    existing.stale &&= reception.stale;
    existing.waitingAgents = [...existing.waitingAgents, ...waiting];
    existing.observedWaitingAgentCount += reception.observedWaitingAgentCount;
    existing.overflowCount += reception.overflowCount;
  }
  const result: HerdrOfficeProjection = {
    ...office,
    hosts,
    rooms: shown(office.rooms, (item) => item.hostKey).map(room),
    receptions: [...receptions.values()],
    barAgents: shown(office.barAgents, (item) => item.hostKey).map(agent),
    roomRoster: shown(office.roomRoster, (item) => item.hostKey).map((entry) =>
      moved(entry.hostKey) || renamed
        ? {
            ...entry,
            hostKey: building(entry.hostKey),
            hostLabel: label(entry.hostKey, entry.hostLabel),
          }
        : entry,
    ),
    deskRoster: shown(office.deskRoster, (item) => item.desk.hostKey).map(
      (entry) =>
        moved(entry.desk.hostKey) || renamed
          ? {
              ...entry,
              desk: desk(entry.desk),
              hostLabel: label(entry.desk.hostKey, entry.hostLabel),
            }
          : entry,
    ),
    paneRoster: shown(office.paneRoster, (item) => item.device.hostKey).map(
      (entry) =>
        moved(entry.device.hostKey) || renamed
          ? {
              ...entry,
              device: device(entry.device),
              hostLabel: label(entry.device.hostKey, entry.hostLabel),
            }
          : entry,
    ),
    roster: shown(office.roster, (item) => item.hostKey).map((entry) =>
      moved(entry.hostKey) || renamed
        ? {
            ...entry,
            agent: agent(entry.agent),
            hostKey: building(entry.hostKey),
            hostLabel: label(entry.hostKey, entry.hostLabel),
          }
        : entry,
    ),
  };
  // Lookups by agent or pane answer with the building's copy of the agent.
  const base = officeReadModel(office);
  setOfficeReadModel(result, {
    roomCounts: base.roomCounts,
    agentOf: (key) => {
      const found = base.agentOf(key);
      return found && agent(found);
    },
    agentForPane: (connectionId, paneId) => {
      const found = base.agentForPane(connectionId, paneId);
      return found && agent(found);
    },
  });
  return result;
}
