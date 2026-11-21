/**
 * Town's buildings stand for machines (#1047, #1198). By default a building
 * is one machine (this computer or one SSH destination), holding the rooms of
 * every runtime World holds there; with the "Town buildings" setting on "One
 * per runtime" (or `?townBuildings=runtime`) each runtime keeps its own
 * building, as before.
 *
 * Presentation only. A room, desk, pane or agent keeps its own `hostKey`,
 * `workspaceRef`, `tabRef` and pane refs (connection ID and generation): room
 * actions find a room's runtime by them (officeRoomActions.ts
 * `officeSpaceForRoom`), so every action still reaches the runtime that owns
 * it. Which building an item stands in is the separate `buildingKey`, read
 * through `townBuildingOf`; it is set only on copies of a machine's later
 * runtimes' items, and is the machine's first runtime's host key, so a
 * building's own lookups (roof colour, reception filter, Add room) still read
 * a real host: that first runtime.
 *
 * Two Herdr TUI connections on one Herdr endpoint (a startup default and a
 * saved profile of the same socket) report the same workspaces; Town shows
 * the rooms of one of them: the live one, then the writable one.
 */

import type { ConnectionSummary } from "../../api";
import type { State } from "../../store/types";
import { worldHosts } from "../../worldHosts";
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

/** The building an office item stands in: its own host's, unless merged. */
export const townBuildingOf = (item: {
  hostKey: string;
  buildingKey?: string;
}) => item.buildingKey ?? item.hostKey;

/**
 * The Town buildings setting ("host": one building per machine), unless the page's `?townBuildings=machine` or
 * `?townBuildings=runtime` names a layout for comparing the two.
 */
export function townBuildingsMode(
  search: string,
  setting: TownBuildingsMode = "host",
): TownBuildingsMode {
  const flag = new URLSearchParams(search).get("townBuildings");
  if (flag === "runtime") return "runtime";
  return flag === "machine" || flag === "host" ? "host" : setting;
}

/** What Town needs to know of each runtime connection World holds. */
export type TownRuntime = {
  id: string;
  runtime: "herdr" | "herdr-core";
  /** This computer, or one SSH destination, as the service groups hosts. */
  machine: string;
  /** Equal for connections of one runtime endpoint (worldHosts.ts). */
  endpoint: string;
  writable: boolean;
};

function machineOf(
  connection: Pick<ConnectionSummary, "id" | "type" | "ssh_destination">,
) {
  if (connection.type === "local") return "local";
  if (connection.type === "ssh" && connection.ssh_destination)
    return `ssh:${connection.ssh_destination}`;
  // An older catalogue without profile fields: a machine of its own.
  return `connection:${connection.id}`;
}

let cachedRuntimes: {
  connections: State["connections"];
  coreConnections: State["coreConnections"];
  runtimes: TownRuntime[];
} | null = null;

/** Every runtime connection's machine and endpoint (a store selector). */
export function townRuntimes(
  state: Pick<State, "connections" | "coreConnections">,
): TownRuntime[] {
  if (
    cachedRuntimes &&
    cachedRuntimes.connections === state.connections &&
    cachedRuntimes.coreConnections === state.coreConnections
  )
    return cachedRuntimes.runtimes;
  const profiles = new Map<
    string,
    Pick<ConnectionSummary, "id" | "type" | "ssh_destination" | "read_only">
  >();
  for (const each of state.coreConnections ?? []) profiles.set(each.id, each);
  for (const each of state.connections) profiles.set(each.id, each);
  const runtimes = worldHosts(state).map((host): TownRuntime => {
    const profile = profiles.get(host.id) ?? { id: host.id };
    return {
      id: host.id,
      runtime: host.runtime,
      machine: machineOf(profile),
      endpoint: host.endpoint,
      writable: profile.read_only !== true,
    };
  });
  cachedRuntimes = {
    connections: state.connections,
    coreConnections: state.coreConnections,
    runtimes,
  };
  return runtimes;
}

/** How a room's runtime reads on its plaque, card and in Move menus. */
export function townRuntimeTag(runtime: TownRuntime["runtime"]) {
  return runtime === "herdr" ? "Herdr TUI" : runtime;
}

type Plan = {
  /** Host keys whose items Town leaves out: a second view of one endpoint. */
  hidden: Set<string>;
  /** Building key by office host key, for a machine's later runtimes. */
  buildingOf: Map<string, string>;
  /** A room's runtime, in buildings of more than one runtime. */
  tagOf: Map<string, string>;
  /** Room order offset, so a machine's runtimes' rooms stay apart. */
  orderOffset: Map<string, number>;
  /** A merged building's first host, stale only when all its runtimes are. */
  primaryStale: Map<string, boolean>;
  signature: string;
};

/** Rooms of a machine's later runtimes follow its first runtime's rooms. */
const RUNTIME_ORDER_STRIDE = 1_000_000;

function plan(
  office: HerdrOfficeProjection,
  runtimes: readonly TownRuntime[],
  mode: TownBuildingsMode,
): Plan {
  const runtimeOf = new Map(runtimes.map((each) => [each.id, each]));
  const known = office.hosts.filter((host) => runtimeOf.has(host.connectionId));
  // One endpoint, one set of rooms: the live view first, then the writable.
  const hidden = new Set<string>();
  const byEndpoint = new Map<string, OfficeHost[]>();
  for (const host of known) {
    const endpoint = runtimeOf.get(host.connectionId)!.endpoint;
    byEndpoint.set(endpoint, [...(byEndpoint.get(endpoint) ?? []), host]);
  }
  const rank = (host: OfficeHost) =>
    (host.stale ? 0 : 2) + (runtimeOf.get(host.connectionId)!.writable ? 1 : 0);
  for (const views of byEndpoint.values()) {
    if (views.length < 2) continue;
    const kept = views.reduce((best, host) =>
      rank(host) > rank(best) ? host : best,
    );
    for (const host of views) if (host !== kept) hidden.add(host.key);
  }
  const buildingOf = new Map<string, string>();
  const tagOf = new Map<string, string>();
  const orderOffset = new Map<string, number>();
  const primaryStale = new Map<string, boolean>();
  if (mode === "host") {
    const byMachine = new Map<string, OfficeHost[]>();
    for (const host of known) {
      if (hidden.has(host.key)) continue;
      const machine = runtimeOf.get(host.connectionId)!.machine;
      byMachine.set(machine, [...(byMachine.get(machine) ?? []), host]);
    }
    for (const members of byMachine.values()) {
      if (members.length < 2) continue;
      // The first runtime in Town's order keys the building, whatever its
      // state, so rooms never change building when a runtime drops.
      const [first, ...later] = members as [OfficeHost, ...OfficeHost[]];
      const kinds = members.map(
        (host) => runtimeOf.get(host.connectionId)!.runtime,
      );
      members.forEach((host, index) => {
        const kind = kinds[index]!;
        const tag = townRuntimeTag(kind);
        // Two runtimes of one kind on a machine: their names tell them apart.
        tagOf.set(
          host.key,
          kinds.filter((each) => each === kind).length > 1
            ? `${tag} · ${host.displayLabel}`
            : tag,
        );
        if (index) orderOffset.set(host.key, index * RUNTIME_ORDER_STRIDE);
      });
      for (const host of later) buildingOf.set(host.key, first.key);
      const stale = members.every((host) => host.stale);
      if (stale !== first.stale) primaryStale.set(first.key, stale);
    }
  }
  const signature = JSON.stringify([
    [...hidden],
    [...buildingOf],
    [...tagOf],
    [...primaryStale],
  ]);
  return { hidden, buildingOf, tagOf, orderOffset, primaryStale, signature };
}

type Caches = {
  agents: WeakMap<OfficeAgent, OfficeAgent>;
  desks: WeakMap<OfficeDesk, OfficeDesk>;
  devices: WeakMap<OfficePaneDevice, OfficePaneDevice>;
  rooms: WeakMap<OfficeRoom, OfficeRoom>;
};

const freshCaches = (): Caches => ({
  agents: new WeakMap(),
  desks: new WeakMap(),
  devices: new WeakMap(),
  rooms: new WeakMap(),
});

/**
 * Places the office's rooms and agents in machine buildings. Keeps object
 * identity for unchanged inputs (and the whole office when nothing moves),
 * so the town re-lays out only when the office itself changed.
 */
export function createTownBuildings() {
  let signature = "";
  let caches = freshCaches();
  let last: {
    office: HerdrOfficeProjection;
    runtimes: readonly TownRuntime[];
    mode: TownBuildingsMode;
    result: HerdrOfficeProjection;
  } | null = null;
  return (
    office: HerdrOfficeProjection,
    runtimes: readonly TownRuntime[],
    mode: TownBuildingsMode,
  ): HerdrOfficeProjection => {
    if (
      last &&
      last.office === office &&
      last.runtimes === runtimes &&
      last.mode === mode
    )
      return last.result;
    const next = plan(office, runtimes, mode);
    if (next.signature !== signature) {
      signature = next.signature;
      caches = freshCaches();
    }
    const result = apply(office, next, caches);
    last = { office, runtimes, mode, result };
    return result;
  };
}

function apply(
  office: HerdrOfficeProjection,
  { hidden, buildingOf, tagOf, orderOffset, primaryStale }: Plan,
  cache: Caches,
): HerdrOfficeProjection {
  if (!hidden.size && !buildingOf.size && !tagOf.size) return office;
  const shown = (item: { hostKey: string }) => !hidden.has(item.hostKey);
  const memo = <T extends object>(
    map: WeakMap<T, T>,
    item: T,
    make: () => T,
  ) => {
    let mapped = map.get(item);
    if (!mapped) map.set(item, (mapped = make()));
    return mapped;
  };
  // Only `buildingKey` (and a room's tag and order in its building) differ
  // on a copy; every identity field is the original's.
  const placed = <T extends { hostKey: string }>(item: T) =>
    buildingOf.has(item.hostKey)
      ? { ...item, buildingKey: buildingOf.get(item.hostKey)! }
      : item;
  const agent = (item: OfficeAgent) =>
    buildingOf.has(item.hostKey)
      ? memo(cache.agents, item, () => placed(item))
      : item;
  const device = (item: OfficePaneDevice) =>
    buildingOf.has(item.hostKey)
      ? memo(cache.devices, item, () => placed(item))
      : item;
  const desk = (item: OfficeDesk) =>
    buildingOf.has(item.hostKey)
      ? memo(cache.desks, item, () => ({
          ...placed(item),
          paneDevices: item.paneDevices.map(device),
        }))
      : item;
  const room = (item: OfficeRoom) =>
    tagOf.has(item.hostKey)
      ? memo(cache.rooms, item, () => ({
          ...placed(item),
          runtimeTag: tagOf.get(item.hostKey),
          buildingOrder: item.order + (orderOffset.get(item.hostKey) ?? 0),
          desks: item.desks.map(desk),
          roomAgents: item.roomAgents.map(agent),
        }))
      : item;
  const reception = (item: OfficeReception) =>
    buildingOf.has(item.hostKey)
      ? { ...placed(item), waitingAgents: item.waitingAgents.map(agent) }
      : item;
  const host = (item: OfficeHost) =>
    buildingOf.has(item.key)
      ? { ...item, buildingKey: buildingOf.get(item.key)! }
      : primaryStale.has(item.key)
        ? { ...item, stale: primaryStale.get(item.key)! }
        : item;
  const result: HerdrOfficeProjection = {
    ...office,
    hosts: office.hosts.filter((item) => !hidden.has(item.key)).map(host),
    rooms: office.rooms.filter(shown).map(room),
    receptions: office.receptions.filter(shown).map(reception),
    barAgents: office.barAgents.filter(shown).map(agent),
    roomRoster: office.roomRoster.filter(shown).map(placed),
    deskRoster: office.deskRoster
      .filter((entry) => shown(entry.desk))
      .map((entry) =>
        buildingOf.has(entry.desk.hostKey)
          ? { ...entry, desk: desk(entry.desk) }
          : entry,
      ),
    paneRoster: office.paneRoster
      .filter((entry) => shown(entry.device))
      .map((entry) =>
        buildingOf.has(entry.device.hostKey)
          ? { ...entry, device: device(entry.device) }
          : entry,
      ),
    roster: office.roster
      .filter(shown)
      .map((entry) =>
        buildingOf.has(entry.hostKey)
          ? { ...placed(entry), agent: agent(entry.agent) }
          : entry,
      ),
  };
  // Lookups by agent or pane answer with the building's copy of the agent,
  // and nothing for a hidden second view of an endpoint.
  const base = officeReadModel(office);
  const visible = (found: OfficeAgent | undefined) =>
    found && shown(found) ? agent(found) : undefined;
  setOfficeReadModel(result, {
    roomCounts: base.roomCounts,
    agentOf: (key) => visible(base.agentOf(key)),
    agentForPane: (connectionId, paneId) =>
      visible(base.agentForPane(connectionId, paneId)),
  });
  return result;
}
