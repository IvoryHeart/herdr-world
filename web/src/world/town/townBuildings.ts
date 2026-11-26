/**
 * Town's buildings stand for World's runtime groups (#1047, #1198, #1397). By
 * default a building is one machine (this computer or one SSH destination),
 * holding the rooms of every runtime World holds there; with World's "Group
 * runtimes" setting (#1307) on "One per runtime" each runtime keeps its own
 * building. Which runtimes share a building is the grouping World publishes
 * (`host_grouping`, shared/hostGrouping.ts), the same groups the navigator,
 * Desk, Board, the Hosts control and `herdr-world ls` show; this module only
 * renders it.
 *
 * Presentation only. A room, desk, pane or agent keeps its own `hostKey`,
 * `workspaceRef`, `tabRef` and pane refs (connection ID and generation): room
 * actions find a room's runtime by them (officeRoomActions.ts
 * `officeSpaceForRoom`), so every action still reaches the runtime that owns
 * it. Which building an item stands in is the separate `buildingKey`, read
 * through `townBuildingOf`; it is set only on copies of a group's later
 * runtimes' items, and is the group's first runtime's host key, so a
 * building's own lookups (roof colour, reception filter, Add room) still read
 * a real host: that first runtime.
 *
 * Two Herdr TUI connections on one Herdr endpoint (a startup default and a
 * saved profile of the same socket) report the same workspaces; Town shows
 * the rooms of the one World publishes as shown: the endpoint's fixed anchor,
 * or another live view while the anchor is down, standing where the anchor's
 * rooms stood and keeping their spots and colours (`placeConnectionId`).
 */

import type {
  HerdrOfficeProjection,
  OfficeAgent,
  OfficeDesk,
  OfficeHost,
  OfficePaneDevice,
  OfficeReception,
  OfficeRoom,
} from "../herdrOfficeProjection";
import type {
  GroupingRuntime,
  HostGrouping,
} from "../../../../shared/hostGrouping";
import { runtimeTag } from "../../worldHosts";
import { officeReadModel, setOfficeReadModel } from "../officeReadModel";

/** The building an office item stands in: its own host's, unless merged. */
export const townBuildingOf = (item: {
  hostKey: string;
  buildingKey?: string;
}) => item.buildingKey ?? item.hostKey;

/** How a room's runtime reads on its plaque, card and in Move menus. */
export function townRuntimeTag(runtime: GroupingRuntime) {
  return runtimeTag(runtime);
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
  /** Building key by office host key, for a group's later runtimes. */
  buildingOf: Map<string, string>;
  /** A room's runtime, in buildings of more than one runtime. */
  tagOf: Map<string, { tag: string; kind: GroupingRuntime }>;
  /** Room order offset, so a group's runtimes' rooms stay apart. */
  orderOffset: Map<string, number>;
  /** A merged building's first host, stale only when all its runtimes are. */
  primaryStale: Map<string, boolean>;
  signature: string;
};

/** Rooms of a group's later runtimes follow its first runtime's rooms. */
const RUNTIME_ORDER_STRIDE = 1_000_000;

/**
 * The view World shows for each published endpoint, among the office's
 * hosts: the published one, else the anchor, else the first present. Others
 * are hidden; a shown view that is not the anchor stands in its place.
 */
function endpointViews(
  hosts: readonly OfficeHost[],
  grouping: HostGrouping | undefined,
) {
  const hidden = new Set<string>();
  const placeOf = new Map<string, OfficeHost>();
  const byConnection = new Map(hosts.map((host) => [host.connectionId, host]));
  for (const endpoint of grouping?.endpoints ?? []) {
    const present = endpoint.views.flatMap((id) => {
      const host = byConnection.get(id);
      return host ? [host] : [];
    });
    if (present.length < 2) continue;
    const anchor = byConnection.get(endpoint.anchor);
    const kept = byConnection.get(endpoint.shown) ?? anchor ?? present[0]!;
    for (const host of present) if (host !== kept) hidden.add(host.key);
    if (anchor && kept !== anchor) placeOf.set(kept.key, anchor);
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
  grouping: HostGrouping | undefined,
): Plan {
  const groupOf = new Map<string, string>();
  const kindOf = new Map<string, GroupingRuntime>();
  for (const group of grouping?.groups ?? [])
    for (const member of group.members) {
      groupOf.set(member.connection_id, group.key);
      kindOf.set(member.connection_id, member.runtime);
    }
  const { hidden, placeOf } = endpointViews(office.hosts, grouping);
  const buildingOf = new Map<string, string>();
  const tagOf: Plan["tagOf"] = new Map();
  const orderOffset = new Map<string, number>();
  const primaryStale = new Map<string, boolean>();
  const byGroup = new Map<string, OfficeHost[]>();
  for (const host of shownHosts(office.hosts, hidden, placeOf)) {
    // A runtime World has not grouped (yet) stands alone.
    const group =
      groupOf.get(host.connectionId) ?? `runtime:${host.connectionId}`;
    byGroup.set(group, [...(byGroup.get(group) ?? []), host]);
  }
  for (const members of byGroup.values()) {
    if (members.length < 2) continue;
    // The first runtime in Town's order keys the building, whatever its
    // state, so rooms never change building when a runtime drops.
    const [first, ...later] = members as [OfficeHost, ...OfficeHost[]];
    const kinds = members.map(
      (host) => kindOf.get(host.connectionId) ?? "herdr",
    );
    members.forEach((host, index) => {
      const kind = kinds[index]!;
      const tag = townRuntimeTag(kind);
      const label = (placeOf.get(host.key) ?? host).displayLabel;
      // Two runtimes of one kind on a machine: their names tell them apart.
      tagOf.set(host.key, {
        tag:
          kinds.filter((each) => each === kind).length > 1
            ? `${tag} · ${label}`
            : tag,
        kind,
      });
      if (index) orderOffset.set(host.key, index * RUNTIME_ORDER_STRIDE);
    });
    for (const host of later) buildingOf.set(host.key, first.key);
    const stale = members.every((host) => host.stale);
    if (stale !== first.stale) primaryStale.set(first.key, stale);
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
 * Places the office's rooms and agents in World's published groups. Keeps
 * object identity for unchanged inputs (and the whole office when nothing
 * moves), so the town re-lays out only when the office itself changed.
 */
export function createTownBuildings() {
  let signature = "";
  let caches = freshCaches();
  let last: {
    office: HerdrOfficeProjection;
    grouping: HostGrouping | undefined;
    result: HerdrOfficeProjection;
  } | null = null;
  return (
    office: HerdrOfficeProjection,
    grouping: HostGrouping | undefined,
  ): HerdrOfficeProjection => {
    if (last && last.office === office && last.grouping === grouping)
      return last.result;
    const next = plan(office, grouping);
    if (next.signature !== signature) {
      signature = next.signature;
      caches = freshCaches();
    }
    const result = apply(office, next, caches);
    last = { office, grouping, result };
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
            runtimeTag: tagOf.get(item.hostKey)!.tag,
            runtimeKind: tagOf.get(item.hostKey)!.kind,
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
