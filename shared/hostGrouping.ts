/**
 * How World groups the runtimes it holds (openspec world-one-object, step 2),
 * at two levels. A host is a machine, always (this computer or one SSH
 * destination, the service's host catalogue, connections/hosts.ts `hostId`),
 * holding every runtime World holds there: every host list and count (the
 * Hosts control and filter, Desk, the navigator, Board, `herdr-world ls`)
 * reads `hosts`. Within a host, the "Group runtimes" setting
 * (`ui.runtimeGrouping`, #1307) decides only how its runtimes are drawn: one
 * Town building per machine, or one per runtime (`groups`). It never changes
 * how many hosts there are.
 *
 * The service derives it once (service/world-commands.ts) and publishes it in
 * `world.snapshot` as `host_grouping`, under the same revision as the setting
 * it was derived from. Nothing is stored: it is a pure function of the
 * setting, the catalogue and which connections World observes as stale.
 * Town's buildings, the Hosts control, Desk, the navigator, Board and
 * `herdr-world ls` all read the published value; none groups on its own.
 *
 * Two Herdr TUI connections on one endpoint (a startup default and a saved
 * profile of the same socket) report the same workspaces. The publication
 * names, per such endpoint, its anchor (from profiles alone, so what is kept
 * under it survives a takeover) and the view Town shows: the anchor, or a
 * live view while the anchor is stale. Presentation only: actions stay
 * qualified by their own connection ID and generation.
 */

export type RuntimeGrouping = "machine" | "runtime";
export type GroupingRuntime = "herdr" | "herdr-core";

/** The setting's key in the service's settings.json `ui`. */
export const RUNTIME_GROUPING_SETTING_KEY = "runtimeGrouping";
export const RUNTIME_GROUPING_DEFAULT: RuntimeGrouping = "machine";

export function parseRuntimeGrouping(value: unknown): RuntimeGrouping | null {
  return value === "machine" || value === "runtime" ? value : null;
}

/** The fields of a `connections.list` entry grouping reads. */
export type GroupingProfile = {
  id: string;
  label: string;
  type?: string;
  ssh_destination?: string;
  control_socket_path?: string;
  client_socket_path?: string;
  remote_control_socket_path?: string;
  remote_client_socket_path?: string;
  core_state_dir?: string;
  core_session?: string;
  read_only?: boolean;
  /** The service's startup default: World lists it first. */
  is_default?: boolean;
};

/** @internal One runtime connection as grouping sees it. */
export type GroupingHost = {
  id: string;
  label: string;
  runtime: GroupingRuntime;
  /** `local`, `ssh:<destination>`, or a machine of its own. */
  machine: string;
  /** Equal for connections of one runtime endpoint. */
  endpoint: string;
  writable: boolean;
  isDefault?: boolean;
};

/** The machine a connection's runtime runs on. */
function hostMachine(
  profile: Pick<GroupingProfile, "id" | "type" | "ssh_destination">,
) {
  if (profile.type === "local") return "local";
  if (profile.type === "ssh" && profile.ssh_destination)
    return `ssh:${profile.ssh_destination}`;
  // An older catalogue without profile fields: a machine of its own.
  return `connection:${profile.id}`;
}

/**
 * A Herdr TUI endpoint: the same place and socket path strings, as the
 * service compares saved endpoints (connections/profiles.ts). Paths are not
 * resolved: a second spelling of a socket stays a second endpoint.
 */
function tuiEndpoint(profile: GroupingProfile): string {
  if (
    profile.type === "local" &&
    profile.control_socket_path &&
    profile.client_socket_path
  )
    return JSON.stringify([
      "local",
      profile.control_socket_path,
      profile.client_socket_path,
    ]);
  if (
    profile.type === "ssh" &&
    profile.ssh_destination &&
    profile.remote_control_socket_path &&
    profile.remote_client_socket_path
  )
    return JSON.stringify([
      "ssh",
      profile.ssh_destination,
      profile.remote_control_socket_path,
      profile.remote_client_socket_path,
    ]);
  return JSON.stringify(["connection", profile.id]);
}

/**
 * One core per (where, state directory, session). An empty state directory
 * is core's own default there, so two such profiles name the same core.
 */
function coreEndpoint(profile: GroupingProfile): string {
  return JSON.stringify([
    "herdr-core",
    profile.type,
    profile.ssh_destination ?? "",
    profile.core_state_dir,
    profile.core_session,
  ]);
}

/**
 * Herdr (TUI) connections first, in catalogue order, then herdr-core ones. A
 * core ID the TUI catalogue also lists is the TUI's.
 * @internal
 */
export function groupingHosts(
  connections: readonly GroupingProfile[],
  coreConnections: readonly GroupingProfile[] = [],
): GroupingHost[] {
  const tuiIds = new Set(connections.map(({ id }) => id));
  return [
    ...connections.map((profile) => ({
      id: profile.id,
      label: profile.label,
      runtime: "herdr" as const,
      machine: hostMachine(profile),
      endpoint: tuiEndpoint(profile),
      writable: profile.read_only !== true,
      isDefault: profile.is_default === true,
    })),
    ...coreConnections
      .filter(({ id }) => !tuiIds.has(id))
      .map((profile) => ({
        id: profile.id,
        label: profile.label,
        runtime: "herdr-core" as const,
        machine: hostMachine(profile),
        endpoint: coreEndpoint(profile),
        writable: profile.read_only !== true,
      })),
  ];
}

/**
 * The group a runtime stands in: its machine, or itself. A second view of an
 * endpoint is the same runtime, so it stands in its anchor's group.
 */
function runtimeGroupKey(
  host: Pick<GroupingHost, "id" | "machine">,
  grouping: RuntimeGrouping,
  anchorOf: ReadonlyMap<string, string>,
) {
  return grouping === "machine"
    ? host.machine
    : `runtime:${anchorOf.get(host.id) ?? host.id}`;
}

type HostGroupMember = {
  connection_id: string;
  runtime: GroupingRuntime;
  label: string;
};

/** Runtimes shown together: a host (machine), or one building of one. */
type HostGroup = {
  key: string;
  /**
   * Its name in every view: its first runtime's that stands for an endpoint
   * (a second view of an endpoint stands behind its anchor, whose name it
   * shows even while taking over), else its first runtime's.
   */
  label: string;
  /** Its runtimes, in World's order (`compareWorldOrder`). */
  members: HostGroupMember[];
};

/** Views of one endpoint, when there are two or more. */
type HostEndpoint = {
  /** In catalogue order. */
  views: string[];
  /** The first writable view, else the first: profiles alone decide it. */
  anchor: string;
  /** The view shown: the anchor, or a live view while the anchor is stale. */
  shown: string;
};

/** One Town building: some or all of one host's runtimes. */
type HostBuilding = HostGroup & {
  /** The key of the host (machine) it stands on. */
  host: string;
};

export type HostGrouping = {
  grouping: RuntimeGrouping;
  /**
   * The machines: what every host list and count shows, whatever the
   * setting. In the order of the runtimes they are named after
   * (`compareWorldOrder`).
   */
  hosts: HostGroup[];
  /**
   * How Town draws the runtimes as buildings under the setting: one per
   * host, or one per runtime. In the same order as `hosts`' runtimes.
   */
  groups: HostBuilding[];
  endpoints: HostEndpoint[];
};

/**
 * World's order of its runtimes, the order every view lists them in: the
 * startup default first, then by name, then by connection ID.
 */
export function compareWorldOrder(
  left: { id: string; label: string; isDefault?: boolean },
  right: { id: string; label: string; isDefault?: boolean },
) {
  return (
    Number(right.isDefault === true) - Number(left.isDefault === true) ||
    left.label.localeCompare(right.label) ||
    left.id.localeCompare(right.id)
  );
}

const worldOrder = (hosts: readonly GroupingHost[]) =>
  [...hosts].sort(compareWorldOrder);

/**
 * The catalogue's groups, each named after its first runtime that stands for
 * an endpoint (not `behind` an anchor), in World's order of those runtimes.
 * Town shows a building only for such runtimes, so every view names and
 * orders a group as Town's building.
 */
function hostGroups(
  hosts: readonly GroupingHost[],
  grouping: RuntimeGrouping,
  behind: ReadonlyMap<string, string>,
): HostGroup[] {
  const byKey = new Map<string, HostGroup & { at: number; named: boolean }>();
  worldOrder(hosts).forEach((host, index) => {
    const key = runtimeGroupKey(host, grouping, behind);
    const group = byKey.get(key) ?? {
      key,
      label: host.label,
      members: [],
      at: index,
      named: false,
    };
    if (!group.named && !behind.has(host.id))
      Object.assign(group, { label: host.label, at: index, named: true });
    group.members.push({
      connection_id: host.id,
      runtime: host.runtime,
      label: host.label,
    });
    byKey.set(key, group);
  });
  return [...byKey.values()]
    .sort((left, right) => left.at - right.at)
    .map(({ key, label, members }) => ({ key, label, members }));
}

/** @internal Each endpoint of two or more views: its anchor and the view shown. */
export function hostEndpoints(
  hosts: readonly GroupingHost[],
  stale: (connectionId: string) => boolean,
): HostEndpoint[] {
  const byEndpoint = new Map<string, GroupingHost[]>();
  for (const host of hosts)
    byEndpoint.set(host.endpoint, [
      ...(byEndpoint.get(host.endpoint) ?? []),
      host,
    ]);
  const endpoints: HostEndpoint[] = [];
  for (const views of byEndpoint.values()) {
    if (views.length < 2) continue;
    const anchor = views.find((view) => view.writable) ?? views[0]!;
    const live = views.filter((view) => !stale(view.id));
    const shown = !stale(anchor.id)
      ? anchor
      : (live.find((view) => view.writable) ?? live[0] ?? anchor);
    endpoints.push({
      views: views.map(({ id }) => id),
      anchor: anchor.id,
      shown: shown.id,
    });
  }
  return endpoints;
}

/** @internal World's grouping of its runtimes: the one derivation every view reads. */
export function deriveHostGrouping(
  hosts: readonly GroupingHost[],
  setting: unknown,
  stale: (connectionId: string) => boolean,
): HostGrouping {
  const grouping = parseRuntimeGrouping(setting) ?? RUNTIME_GROUPING_DEFAULT;
  const endpoints = hostEndpoints(hosts, stale);
  const behind = new Map(
    endpoints.flatMap(({ views, anchor }) =>
      views.flatMap((view) =>
        view !== anchor ? [[view, anchor] as const] : [],
      ),
    ),
  );
  const hostOf = new Map(hosts.map((host) => [host.id, host.machine]));
  return {
    grouping,
    hosts: hostGroups(hosts, "machine", behind),
    groups: hostGroups(hosts, grouping, behind).map((group) => ({
      ...group,
      host: hostOf.get(group.members[0]!.connection_id)!,
    })),
    endpoints,
  };
}

/**
 * The grouping one `world.snapshot` reply carries: derived from the
 * connection catalogue, the setting it publishes and its connections'
 * staleness (a connection the reply does not hold counts as stale).
 */
export function publishedHostGrouping(
  catalogue: {
    connections: readonly GroupingProfile[];
    core: readonly GroupingProfile[];
  },
  setting: unknown,
  connections: readonly { connection_id: string; stale: boolean }[],
): HostGrouping {
  const stale = new Map(
    connections.map((each) => [each.connection_id, each.stale]),
  );
  return deriveHostGrouping(
    groupingHosts(catalogue.connections, catalogue.core),
    setting,
    (id) => stale.get(id) ?? true,
  );
}

const anchorsCache = new WeakMap<
  Pick<HostGrouping, "endpoints">,
  ReadonlyMap<string, string>
>();
const NO_ANCHORS: ReadonlyMap<string, string> = new Map();

/**
 * A connection's endpoint anchor, for views that are not their endpoint's
 * anchor: what is kept per endpoint (desk pins) is kept under it, and two
 * connections with one anchor are one runtime.
 */
export function endpointAnchors(
  grouping: Pick<HostGrouping, "endpoints"> | undefined,
): ReadonlyMap<string, string> {
  if (!grouping) return NO_ANCHORS;
  const known = anchorsCache.get(grouping);
  if (known) return known;
  const anchors = new Map<string, string>();
  for (const endpoint of grouping.endpoints)
    for (const view of endpoint.views)
      if (view !== endpoint.anchor) anchors.set(view, endpoint.anchor);
  anchorsCache.set(grouping, anchors);
  return anchors;
}

/**
 * One bound for groups, a group's members and an endpoint's views: any one
 * of them may hold every connection the service registers (64 saved
 * profiles, the startup default and herdr-core connections), so the replica
 * keeps the service's complete membership and never cuts a group short.
 */
const LIMITS = { connections: 512, text: 1024 };

const text = (value: unknown) =>
  typeof value === "string" && value.length > 0 && value.length <= LIMITS.text
    ? value
    : null;
const record = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** A published `host_grouping`, bounded; null when malformed. */
export function parseHostGrouping(value: unknown): HostGrouping | null {
  const item = record(value);
  const grouping = parseRuntimeGrouping(item?.grouping);
  if (
    !item ||
    !grouping ||
    !Array.isArray(item.hosts) ||
    !Array.isArray(item.groups) ||
    !Array.isArray(item.endpoints)
  )
    return null;
  const hosts = item.hosts
    .slice(0, LIMITS.connections)
    .flatMap((entry) => parseGroup(entry) ?? []);
  const hostKeys = new Set(hosts.map(({ key }) => key));
  const groups = item.groups
    .slice(0, LIMITS.connections)
    .flatMap((entry): HostBuilding[] => {
      const group = parseGroup(entry);
      const host = text(record(entry)?.host);
      return group && host && hostKeys.has(host) ? [{ ...group, host }] : [];
    });
  const endpoints = item.endpoints
    .slice(0, LIMITS.connections)
    .flatMap((entry): HostEndpoint[] => {
      const endpoint = record(entry);
      const anchor = text(endpoint?.anchor);
      const shown = text(endpoint?.shown);
      const views = Array.isArray(endpoint?.views)
        ? endpoint.views.slice(0, LIMITS.connections).flatMap((view) => {
            const id = text(view);
            return id ? [id] : [];
          })
        : [];
      return anchor &&
        shown &&
        views.length > 1 &&
        views.includes(anchor) &&
        views.includes(shown)
        ? [{ views, anchor, shown }]
        : [];
    });
  return { grouping, hosts, groups, endpoints };
}

function parseGroup(value: unknown): HostGroup | null {
  const group = record(value);
  const key = text(group?.key);
  const label = typeof group?.label === "string" ? group.label : null;
  if (!group || !key || label === null || !Array.isArray(group.members))
    return null;
  const members = group.members
    .slice(0, LIMITS.connections)
    .flatMap((each): HostGroupMember[] => {
      const member = record(each);
      const id = text(member?.connection_id);
      return member &&
        id &&
        (member.runtime === "herdr" || member.runtime === "herdr-core") &&
        typeof member.label === "string"
        ? [{ connection_id: id, runtime: member.runtime, label: member.label }]
        : [];
    });
  return members.length ? { key, label, members } : null;
}
