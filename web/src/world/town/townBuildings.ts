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
 * the rooms of one of them (`endpointViews`): a fixed anchor, the writable
 * one, or another live view while the anchor is down, standing where the
 * anchor's rooms stood and keeping their spots and colours
 * (`placeConnectionId`).
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
  /** This computer, or one SSH destination (worldHosts.ts `machine`). */
  machine: string;
  /** Equal for connections of one runtime endpoint (worldHosts.ts). */
  endpoint: string;
  writable: boolean;
};

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
  const profiles = new Map<string, Pick<ConnectionSummary, "read_only">>();
  for (const each of state.coreConnections ?? []) profiles.set(each.id, each);
  for (const each of state.connections) profiles.set(each.id, each);
  const runtimes = worldHosts(state).map((host): TownRuntime => {
    const profile = profiles.get(host.id) ?? {};
    return {
      id: host.id,
      runtime: host.runtime,
      machine: host.machine,
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
  /**
   * A view Town shows in place of its endpoint's anchor (the anchor is down,
   * this view is live), by its host key: the anchor's host. Its building
   * stands, looks and keeps its rooms' spots as the anchor's did.
   */
  placeOf: Map<string, OfficeHost>;
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

const anchorsCache = new WeakMap<readonly TownRuntime[], Map<string, string>>();

/**
 * Each endpoint's anchor by connection ID, for the views that are not their
 * endpoint's anchor: its first writable view in catalogue order (the order
 * `townRuntimes` lists), else its first. Profiles alone decide it, never
 * state, so what is kept under the anchor (desk pins, useDeskPins.ts) holds
 * through a takeover.
 */
export function townEndpointAnchors(
  runtimes: readonly TownRuntime[],
): ReadonlyMap<string, string> {
  const cached = anchorsCache.get(runtimes);
  if (cached) return cached;
  const byEndpoint = new Map<string, TownRuntime[]>();
  for (const each of runtimes)
    byEndpoint.set(each.endpoint, [
      ...(byEndpoint.get(each.endpoint) ?? []),
      each,
    ]);
  const anchors = new Map<string, string>();
  for (const views of byEndpoint.values()) {
    const anchor = views.find((view) => view.writable) ?? views[0]!;
    for (const view of views)
      if (view !== anchor) anchors.set(view.id, anchor.id);
  }
  anchorsCache.set(runtimes, anchors);
  return anchors;
}

/**
 * Which view of each endpoint Town shows. Views share an endpoint when
 * worldHosts.ts gives them the same `endpoint`: the same runtime, place and
 * socket path strings, as the service compares saved endpoints
 * (connections/profiles.ts). Paths are not resolved: a second spelling of a
 * socket (a symlink) stays a second view, shown twice rather than hidden.
 *
 * Each endpoint's anchor (`townEndpointAnchors`) is chosen from its
 * profiles alone, never their state: the first writable view in catalogue
 * order, else the first. Town
 * shows the anchor's rooms, unless the anchor is down and another view is
 * live: then that view's (writable first), standing where the anchor's
 * stood, so a takeover moves no building and no saved room.
 */
function endpointViews<View extends { connectionId: string; stale: boolean }>(
  known: readonly View[],
  runtimeOf: ReadonlyMap<string, TownRuntime>,
) {
  const anchors = townEndpointAnchors([...runtimeOf.values()]);
  const hidden = new Set<View>();
  const placeOf = new Map<View, View>();
  const byEndpoint = new Map<string, View[]>();
  for (const view of known) {
    const endpoint = runtimeOf.get(view.connectionId)!.endpoint;
    byEndpoint.set(endpoint, [...(byEndpoint.get(endpoint) ?? []), view]);
  }
  const writable = (view: View) => runtimeOf.get(view.connectionId)!.writable;
  for (const views of byEndpoint.values()) {
    if (views.length < 2) continue;
    const anchorId =
      anchors.get(views[0]!.connectionId) ?? views[0]!.connectionId;
    const anchor =
      views.find((view) => view.connectionId === anchorId) ??
      views.find(writable) ??
      views[0]!;
    const live = views.filter((view) => !view.stale);
    const kept = !anchor.stale
      ? anchor
      : (live.find(writable) ?? live[0] ?? anchor);
    for (const view of views) if (view !== kept) hidden.add(view);
    if (kept !== anchor) placeOf.set(kept, anchor);
  }
  return { hidden, placeOf };
}

/** The hosts Town shows, in order: a taken-over view in its anchor's place. */
function shownHosts(
  hosts: readonly OfficeHost[],
  hidden: ReadonlySet<string>,
  placeOf: ReadonlyMap<string, OfficeHost>,
) {
  const standIn = new Map<string, string>();
  for (const [key, anchor] of placeOf) standIn.set(anchor.key, key);
  const byKey = new Map(hosts.map((host) => [host.key, host]));
  const shown: OfficeHost[] = [];
  for (const host of hosts) {
    if (placeOf.has(host.key)) continue;
    const viewKey = standIn.get(host.key);
    if (viewKey) shown.push(byKey.get(viewKey)!);
    else if (!hidden.has(host.key)) shown.push(host);
  }
  return shown;
}

function plan(
  office: HerdrOfficeProjection,
  runtimes: readonly TownRuntime[],
  mode: TownBuildingsMode,
): Plan {
  const runtimeOf = new Map(runtimes.map((each) => [each.id, each]));
  const known = office.hosts.filter((host) => runtimeOf.has(host.connectionId));
  const views = endpointViews(known, runtimeOf);
  const hidden = new Set([...views.hidden].map((host) => host.key));
  const placeOf = new Map(
    [...views.placeOf].map(([kept, anchor]) => [kept.key, anchor]),
  );
  const buildingOf = new Map<string, string>();
  const tagOf = new Map<string, string>();
  const orderOffset = new Map<string, number>();
  const primaryStale = new Map<string, boolean>();
  if (mode === "host") {
    const byMachine = new Map<string, OfficeHost[]>();
    for (const host of shownHosts(known, hidden, placeOf)) {
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
        const label = (placeOf.get(host.key) ?? host).displayLabel;
        // Two runtimes of one kind on a machine: their names tell them apart.
        tagOf.set(
          host.key,
          kinds.filter((each) => each === kind).length > 1
            ? `${tag} · ${label}`
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
    [...placeOf].map(([key, anchor]) => [key, anchor.key]),
    [...buildingOf],
    [...tagOf],
    [...primaryStale],
  ]);
  return {
    hidden,
    placeOf,
    buildingOf,
    tagOf,
    orderOffset,
    primaryStale,
    signature,
  };
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
  { hidden, placeOf, buildingOf, tagOf, orderOffset, primaryStale }: Plan,
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
    tagOf.has(item.hostKey) || placeOf.has(item.hostKey)
      ? memo(cache.rooms, item, () => ({
          ...placed(item),
          ...(tagOf.has(item.hostKey) && {
            runtimeTag: tagOf.get(item.hostKey),
            buildingOrder: item.order + (orderOffset.get(item.hostKey) ?? 0),
          }),
          ...(placeOf.has(item.hostKey) && {
            placeConnectionId: placeOf.get(item.hostKey)!.connectionId,
          }),
          desks: item.desks.map(desk),
          roomAgents: item.roomAgents.map(agent),
        }))
      : item;
  const reception = (item: OfficeReception) =>
    buildingOf.has(item.hostKey)
      ? { ...placed(item), waitingAgents: item.waitingAgents.map(agent) }
      : item;
  const host = (item: OfficeHost): OfficeHost => {
    const anchor = placeOf.get(item.key);
    if (!anchor && !buildingOf.has(item.key) && !primaryStale.has(item.key))
      return item;
    return {
      ...item,
      // A taken-over view stands, and looks, as its endpoint's anchor did.
      ...(anchor && {
        displayLabel: anchor.displayLabel,
        accessibleLabel: anchor.accessibleLabel,
        displayOrder: anchor.displayOrder,
        deterministicSkin: anchor.deterministicSkin,
        placeConnectionId: anchor.connectionId,
      }),
      ...(buildingOf.has(item.key) && {
        buildingKey: buildingOf.get(item.key)!,
      }),
      ...(primaryStale.has(item.key) && {
        stale: primaryStale.get(item.key)!,
      }),
    };
  };
  const result: HerdrOfficeProjection = {
    ...office,
    hosts: shownHosts(office.hosts, hidden, placeOf).map(host),
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
