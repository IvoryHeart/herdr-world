import type { Pane, Tab, Workspace } from "../types";
import type { WorldRuntimeConnection } from "./runtimeStore";

export type WorldObjectKind = "host" | "space" | "agent" | "terminal";
export type WorldAgentStatus =
  | "working"
  | "idle"
  | "blocked"
  | "done"
  | "unknown";
export type WorldAgentStatusCounts = Record<WorldAgentStatus, number>;
export type WorldObservedCoverage = {
  spaces: number;
  tabs: number;
  leaves: number;
  agents: number;
  shells: number;
  status: WorldAgentStatusCounts;
};
export type WorldHostState =
  | "active"
  | "ready-inactive"
  | "reconnecting"
  | "offline-stale";

export type WorldActionCapabilities = {
  activateHost: boolean;
  openTerminal: boolean;
  openSpaces: boolean;
  files: boolean;
  changes: boolean;
  agentHistory: boolean;
  roomMutation: boolean;
  launcher: boolean;
};

type WorldObjectBase = {
  id: string;
  kind: WorldObjectKind;
  nativeId: string;
  parentId: string | null;
  connectionId: string;
  generation: number;
  label: string;
  hostLabel: string;
  hostState: WorldHostState;
  selectedHost: boolean;
  stale: boolean;
  actionable: boolean;
  capabilities: WorldActionCapabilities;
};

export type WorldHostObject = WorldObjectBase & {
  kind: "host";
  parentId: null;
  connection: WorldRuntimeConnection;
  spaces: WorldSpaceObject[];
  coverage: WorldObservedCoverage;
};

export type WorldSpaceObject = WorldObjectBase & {
  kind: "space";
  parentId: string;
  workspace: Workspace;
  tabs: Tab[];
  children: WorldLeafObject[];
  coverage: WorldObservedCoverage;
};

export type WorldLeafObject = WorldObjectBase & {
  kind: "agent" | "terminal";
  parentId: string;
  pane: Pane;
  workspaceId: string;
  tabId: string;
  terminalId: string;
  status: WorldAgentStatus;
  focused: boolean;
  tabLabel?: string;
  tabNumber?: number;
  agentLabel?: string;
  modelLabel?: string;
  taskSummary?: string;
  agentSessionIdentity?: string;
  stateLabels: Partial<Record<WorldAgentStatus, string>>;
  watched?: boolean;
  lastActivityAt?: number;
  spaceLabel: string;
};

export type WorldObjectNode =
  | WorldHostObject
  | WorldSpaceObject
  | WorldLeafObject;

export type WorldObject = {
  version: 1;
  hosts: WorldHostObject[];
  spaces: WorldSpaceObject[];
  leaves: WorldLeafObject[];
  nodes: WorldObjectNode[];
  nodeById: ReadonlyMap<string, WorldObjectNode>;
  coverage: WorldObservedCoverage;
};

export function worldObjectId(
  connectionId: string,
  identity: WorldObjectKind | "pane",
  nativeId: string,
) {
  return JSON.stringify([connectionId, identity, nativeId]);
}

function boundedLabel(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized ? boundedCodePointPrefix(normalized, 100) : fallback;
}

function boundedCodePointPrefix(value: string, limit: number) {
  let result = "";
  let length = 0;
  for (const character of value) {
    if (length >= limit) break;
    result += character;
    length += 1;
  }
  return result;
}

export function boundedOptionalText(
  value: unknown,
  limit: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized
    ? boundedCodePointPrefix(normalized, limit).trimEnd()
    : undefined;
}

type AgentSession = {
  source: string;
  agent: string;
  kind: string;
  value: string;
};

const TASK_SUMMARY_TOKEN = "task_summary";
const TASK_SUMMARY_SESSION_TOKEN = "task_summary_session";

function agentSession(value: unknown): AgentSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const session = value as Record<string, unknown>;
  if (
    typeof session.source !== "string" ||
    typeof session.agent !== "string" ||
    typeof session.kind !== "string" ||
    typeof session.value !== "string" ||
    !session.source ||
    !session.agent ||
    !session.kind ||
    !session.value
  ) {
    return null;
  }
  return {
    source: session.source,
    agent: session.agent,
    kind: session.kind,
    value: session.value,
  };
}

function sameAgentSession(left: AgentSession, right: AgentSession) {
  return (
    left.source === right.source &&
    left.agent === right.agent &&
    left.kind === right.kind &&
    left.value === right.value
  );
}

// WorldObject is synchronous. Keep the small SHA-256 implementation here so a
// token pair can be admitted during one projection without a second poll or an
// asynchronous browser-crypto race.
function sha256(value: string) {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bytes = new TextEncoder().encode(value);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 2 ** 32));
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  let hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Uint32Array(64);
  const rightRotate = (word: number, bits: number) =>
    (word >>> bits) | (word << (32 - bits));
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const first =
        rightRotate(words[index - 15]!, 7) ^
        rightRotate(words[index - 15]!, 18) ^
        (words[index - 15]! >>> 3);
      const second =
        rightRotate(words[index - 2]!, 17) ^
        rightRotate(words[index - 2]!, 19) ^
        (words[index - 2]! >>> 10);
      words[index] =
        (words[index - 16]! + first + words[index - 7]! + second) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 =
        (h + sum1 + choice + constants[index]! + words[index]!) >>> 0;
      const sum0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash = hash.map(
      (word, index) => (word + [a, b, c, d, e, f, g, h][index]!) >>> 0,
    );
  }
  return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}

export function taskSummarySessionFingerprint(session: AgentSession) {
  return sha256(
    JSON.stringify([
      session.source,
      session.agent,
      session.kind,
      session.value,
    ]),
  );
}

function admittedAgentSessionIdentity(
  metadata: Record<string, unknown> | null,
) {
  const value = metadata?.agent_session;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const session = value as Record<string, unknown>;
  const agent = boundedOptionalText(session.agent, 100);
  const kind = boundedOptionalText(session.kind, 100);
  const identity = boundedOptionalText(session.value, 512);
  if (!agent && !kind && !identity) return undefined;
  return JSON.stringify([agent ?? null, kind ?? null, identity ?? null]);
}

function taskSummaryFromTokens(
  pane: Pane,
  agentMetadata: Record<string, unknown> | null,
) {
  const tokens = (pane as Pane & { tokens?: unknown }).tokens;
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) {
    return undefined;
  }
  const summary = (tokens as Record<string, unknown>)[TASK_SUMMARY_TOKEN];
  const fingerprint = (tokens as Record<string, unknown>)[
    TASK_SUMMARY_SESSION_TOKEN
  ];
  if (typeof summary !== "string" || typeof fingerprint !== "string")
    return undefined;
  if (!/^[a-f0-9]{64}$/u.test(fingerprint)) return undefined;
  const paneSession = agentSession(
    (pane as Pane & { agent_session?: unknown }).agent_session,
  );
  if (!paneSession) return undefined;
  const agentValue = agentMetadata?.agent_session;
  const agentSessionValue = agentSession(agentValue);
  if (
    agentValue !== undefined &&
    (!agentSessionValue || !sameAgentSession(paneSession, agentSessionValue))
  ) {
    return undefined;
  }
  if (fingerprint !== taskSummarySessionFingerprint(paneSession))
    return undefined;
  return boundedOptionalText(summary, 160);
}

function status(value: unknown): WorldAgentStatus {
  if (value === "working" || value === "busy" || value === "running") {
    return "working";
  }
  if (value === "idle" || value === "waiting") return "idle";
  if (value === "blocked" || value === "error") return "blocked";
  if (value === "done" || value === "completed") return "done";
  return "unknown";
}

function emptyStatusCounts(): WorldAgentStatusCounts {
  return { working: 0, idle: 0, blocked: 0, done: 0, unknown: 0 };
}

function observedCoverage(
  connection: WorldRuntimeConnection,
): WorldObservedCoverage {
  const snapshot = connection.snapshot;
  if (!snapshot) {
    return {
      spaces: 0,
      tabs: 0,
      leaves: 0,
      agents: 0,
      shells: 0,
      status: emptyStatusCounts(),
    };
  }
  if (snapshot.coverage) {
    return {
      spaces: snapshot.coverage.workspaces,
      tabs: snapshot.coverage.tabs,
      leaves: snapshot.coverage.panes,
      agents: snapshot.coverage.agentPanes,
      shells: Math.max(
        0,
        snapshot.coverage.panes - snapshot.coverage.agentPanes,
      ),
      status: { ...snapshot.coverage.status },
    };
  }
  const statusCounts = emptyStatusCounts();
  let agents = 0;
  for (const pane of snapshot.panes) {
    if (typeof pane.agent !== "string" || !pane.agent.trim()) continue;
    agents += 1;
    statusCounts[status(pane.agent_status)] += 1;
  }
  return {
    spaces: snapshot.workspaces.length,
    tabs: snapshot.tabs.length,
    leaves: snapshot.panes.length,
    agents,
    shells: snapshot.panes.length - agents,
    status: statusCounts,
  };
}

function addCoverage(
  left: WorldObservedCoverage,
  right: WorldObservedCoverage,
): WorldObservedCoverage {
  return {
    spaces: left.spaces + right.spaces,
    tabs: left.tabs + right.tabs,
    leaves: left.leaves + right.leaves,
    agents: left.agents + right.agents,
    shells: left.shells + right.shells,
    status: {
      working: left.status.working + right.status.working,
      idle: left.status.idle + right.status.idle,
      blocked: left.status.blocked + right.status.blocked,
      done: left.status.done + right.status.done,
      unknown: left.status.unknown + right.status.unknown,
    },
  };
}

function hostState(
  connection: WorldRuntimeConnection,
  selectedConnectionId: string | null,
): WorldHostState {
  const ready =
    connection.state === "ready" &&
    connection.actionable &&
    !connection.stale &&
    connection.snapshotGeneration === connection.generation;
  if (ready) {
    return connection.connectionId === selectedConnectionId
      ? "active"
      : "ready-inactive";
  }
  if (
    connection.state === "connecting" ||
    connection.state === "reconnecting" ||
    connection.state === "stopping"
  ) {
    return "reconnecting";
  }
  return "offline-stale";
}

function actionCapabilities(
  kind: WorldObjectKind,
  state: WorldHostState,
): WorldActionCapabilities {
  const operational = state === "active";
  const leaf = kind === "agent" || kind === "terminal";
  const space = kind === "space";
  return {
    activateHost: state === "ready-inactive",
    openTerminal: operational && leaf,
    openSpaces: operational && (leaf || space),
    files: operational && (leaf || space),
    changes: operational && (leaf || space),
    agentHistory: operational && kind === "agent",
    roomMutation: operational && space,
    launcher: operational && space,
  };
}

function admittedStateLabels(
  value: unknown,
): Partial<Record<WorldAgentStatus, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: Partial<Record<WorldAgentStatus, string>> = {};
  for (const key of [
    "working",
    "idle",
    "blocked",
    "done",
    "unknown",
  ] as const) {
    const label = boundedOptionalText(source[key], 96);
    if (label) result[key] = label;
  }
  return result;
}

function matchingAgentMetadata(
  agents: readonly Record<string, unknown>[],
  pane: Pane,
): Record<string, unknown> | null {
  return (
    agents.find((candidate) => {
      if (candidate.pane_id !== pane.pane_id) return false;
      if (
        typeof candidate.terminal_id === "string" &&
        candidate.terminal_id !== pane.terminal_id
      ) {
        return false;
      }
      if (
        typeof candidate.agent === "string" &&
        candidate.agent !== pane.agent
      ) {
        return false;
      }
      return true;
    }) ?? null
  );
}

function buildHost(
  connection: WorldRuntimeConnection,
  selectedConnectionId: string | null,
): WorldHostObject {
  const connectionHostState = hostState(connection, selectedConnectionId);
  const selectedHost = connection.connectionId === selectedConnectionId;
  const hostCapabilities = actionCapabilities("host", connectionHostState);
  const operational = connectionHostState === "active";
  const observedGeneration =
    connection.snapshotGeneration ?? connection.generation;
  const id = worldObjectId(
    connection.connectionId,
    "host",
    connection.connectionId,
  );
  const tabsByWorkspace = new Map<string, Tab[]>();
  const panesByWorkspace = new Map<string, Pane[]>();
  const tabsById = new Map<string, Tab>();
  const workspaceCoverage = new Map(
    (connection.snapshot?.coverage?.byWorkspace ?? []).map((coverage) => [
      coverage.workspaceId,
      coverage,
    ]),
  );
  for (const tab of connection.snapshot?.tabs ?? []) {
    const tabs = tabsByWorkspace.get(tab.workspace_id) ?? [];
    tabs.push(tab);
    tabsByWorkspace.set(tab.workspace_id, tabs);
    tabsById.set(tab.tab_id, tab);
  }
  for (const pane of connection.snapshot?.panes ?? []) {
    const panes = panesByWorkspace.get(pane.workspace_id) ?? [];
    panes.push(pane);
    panesByWorkspace.set(pane.workspace_id, panes);
  }
  const spaces = (connection.snapshot?.workspaces ?? []).map(
    (workspace): WorldSpaceObject => {
      const spaceId = worldObjectId(
        connection.connectionId,
        "space",
        workspace.workspace_id,
      );
      const children = (panesByWorkspace.get(workspace.workspace_id) ?? []).map(
        (pane): WorldLeafObject => {
          const isAgent =
            typeof pane.agent === "string" && pane.agent.trim().length > 0;
          const kind = isAgent ? "agent" : "terminal";
          const capabilities = actionCapabilities(kind, connectionHostState);
          const tab = tabsById.get(pane.tab_id);
          const tabLabel = boundedOptionalText(tab?.label, 100);
          const agentMetadata = isAgent
            ? matchingAgentMetadata(connection.snapshot?.agents ?? [], pane)
            : null;
          const agentLabel = isAgent
            ? boundedOptionalText(
                pane.display_agent ??
                  agentMetadata?.display_agent ??
                  pane.agent,
                100,
              )
            : undefined;
          const modelLabel = isAgent
            ? boundedOptionalText(
                pane.model_name ??
                  pane.model ??
                  agentMetadata?.model_name ??
                  agentMetadata?.model,
                100,
              )
            : undefined;
          const taskSummary = isAgent
            ? (taskSummaryFromTokens(pane, agentMetadata) ??
              boundedOptionalText(
                pane.task_summary ?? agentMetadata?.task_summary,
                160,
              ))
            : undefined;
          const agentSessionIdentity = isAgent
            ? admittedAgentSessionIdentity(agentMetadata)
            : undefined;
          const lastActivityAt = isAgent
            ? (pane.last_activity_at ?? agentMetadata?.last_activity_at)
            : undefined;
          return {
            id: worldObjectId(
              connection.connectionId,
              "terminal",
              pane.terminal_id,
            ),
            kind,
            nativeId: pane.pane_id,
            parentId: spaceId,
            connectionId: connection.connectionId,
            generation: observedGeneration,
            label: boundedLabel(
              agentLabel,
              isAgent ? "Agent" : `Terminal ${pane.pane_id.slice(0, 8)}`,
            ),
            hostLabel: boundedLabel(connection.label, "Host"),
            hostState: connectionHostState,
            selectedHost,
            stale: connection.stale,
            actionable: operational,
            capabilities,
            pane,
            workspaceId: pane.workspace_id,
            tabId: pane.tab_id,
            terminalId: pane.terminal_id,
            status: status(pane.agent_status),
            focused: pane.focused === true,
            spaceLabel: boundedLabel(
              workspace.label,
              `Space ${workspace.number ?? ""}`,
            ),
            ...(tabLabel ? { tabLabel } : {}),
            ...(Number.isSafeInteger(tab?.number)
              ? { tabNumber: tab?.number }
              : {}),
            ...(agentLabel ? { agentLabel } : {}),
            ...(modelLabel ? { modelLabel } : {}),
            ...(taskSummary ? { taskSummary } : {}),
            ...(agentSessionIdentity ? { agentSessionIdentity } : {}),
            stateLabels: isAgent
              ? admittedStateLabels(
                  pane.state_labels ?? agentMetadata?.state_labels,
                )
              : {},
            ...(typeof lastActivityAt === "number" &&
            Number.isFinite(lastActivityAt) &&
            lastActivityAt > 0
              ? { lastActivityAt }
              : {}),
          };
        },
      );
      const exactCoverage = workspaceCoverage.get(workspace.workspace_id);
      const spaceStatus = emptyStatusCounts();
      let spaceAgents = 0;
      if (!exactCoverage) {
        for (const child of children) {
          if (child.kind !== "agent") continue;
          spaceAgents += 1;
          spaceStatus[child.status] += 1;
        }
      }
      return {
        id: spaceId,
        kind: "space",
        nativeId: workspace.workspace_id,
        parentId: id,
        connectionId: connection.connectionId,
        generation: observedGeneration,
        label: boundedLabel(workspace.label, `Space ${workspace.number ?? ""}`),
        hostLabel: boundedLabel(connection.label, "Host"),
        hostState: connectionHostState,
        selectedHost,
        stale: connection.stale,
        actionable: operational,
        capabilities: actionCapabilities("space", connectionHostState),
        workspace,
        tabs: tabsByWorkspace.get(workspace.workspace_id) ?? [],
        children,
        coverage: exactCoverage
          ? {
              spaces: 1,
              tabs: exactCoverage.tabs,
              leaves: exactCoverage.panes,
              agents: exactCoverage.agentPanes,
              shells: Math.max(
                0,
                exactCoverage.panes - exactCoverage.agentPanes,
              ),
              status: { ...exactCoverage.status },
            }
          : {
              spaces: 1,
              tabs: (tabsByWorkspace.get(workspace.workspace_id) ?? []).length,
              leaves: children.length,
              agents: spaceAgents,
              shells: children.length - spaceAgents,
              status: spaceStatus,
            },
      };
    },
  );
  return {
    id,
    kind: "host",
    nativeId: connection.connectionId,
    parentId: null,
    connectionId: connection.connectionId,
    generation: connection.generation,
    label: boundedLabel(connection.label, "Host"),
    hostLabel: boundedLabel(connection.label, "Host"),
    hostState: connectionHostState,
    selectedHost,
    stale: connection.stale,
    actionable: operational,
    capabilities: hostCapabilities,
    connection,
    spaces,
    coverage: observedCoverage(connection),
  };
}

export function buildWorldObject(
  connections: readonly WorldRuntimeConnection[],
  selectedConnectionId: string | null = null,
): WorldObject {
  const hosts = [...connections]
    .sort(
      (left, right) =>
        Number(right.isDefault) - Number(left.isDefault) ||
        left.label.localeCompare(right.label) ||
        left.connectionId.localeCompare(right.connectionId),
    )
    .map((connection) => buildHost(connection, selectedConnectionId));
  const spaces = hosts.flatMap((host) => host.spaces);
  const leaves = spaces.flatMap((space) => space.children);
  const nodes: WorldObjectNode[] = hosts.flatMap((host) => [
    host,
    ...host.spaces.flatMap((space): WorldObjectNode[] => [
      space,
      ...space.children,
    ]),
  ]);
  const coverage = hosts.reduce<WorldObservedCoverage>(
    (total, host) => addCoverage(total, host.coverage),
    {
      spaces: 0,
      tabs: 0,
      leaves: 0,
      agents: 0,
      shells: 0,
      status: emptyStatusCounts(),
    },
  );
  return {
    version: 1,
    hosts,
    spaces,
    leaves,
    nodes,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
    coverage,
  };
}

/**
 * Keeps aggregate observation intact while giving a focused client one coherent
 * host presentation. The returned nodes are the original qualified objects, so
 * identities and runtime generations cannot be rebound by the projection.
 */
export function worldObjectForConnection(
  world: WorldObject,
  connectionId: string | null,
): WorldObject {
  const host = connectionId
    ? world.hosts.find((candidate) => candidate.connectionId === connectionId)
    : undefined;
  const hosts = host ? [host] : [];
  const spaces = host?.spaces ?? [];
  const leaves = spaces.flatMap((space) => space.children);
  const nodes: WorldObjectNode[] = host
    ? [
        host,
        ...spaces.flatMap((space): WorldObjectNode[] => [
          space,
          ...space.children,
        ]),
      ]
    : [];
  return {
    version: 1,
    hosts,
    spaces,
    leaves,
    nodes,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
    coverage: host
      ? host.coverage
      : {
          spaces: 0,
          tabs: 0,
          leaves: 0,
          agents: 0,
          shells: 0,
          status: emptyStatusCounts(),
        },
  };
}

/** Keeps ancestry for a browser-local watched-only presentation. */
export function worldObjectForWatches(
  world: WorldObject,
  watches: readonly {
    connectionId: string;
    generation: number;
    terminalId: string;
  }[],
): WorldObject {
  const keys = new Set(
    watches.map(({ connectionId, generation, terminalId }) =>
      JSON.stringify([connectionId, generation, terminalId]),
    ),
  );
  const hosts = world.hosts.flatMap((host) => {
    const spaces = host.spaces.flatMap((space) => {
      const children = space.children.filter((leaf) =>
        keys.has(
          JSON.stringify([leaf.connectionId, leaf.generation, leaf.terminalId]),
        ),
      );
      return children.length ? [{ ...space, children }] : [];
    });
    return spaces.length ? [{ ...host, spaces }] : [];
  });
  const spaces = hosts.flatMap((host) => host.spaces);
  const leaves = spaces.flatMap((space) => space.children);
  const nodes: WorldObjectNode[] = hosts.flatMap((host) => [
    host,
    ...host.spaces.flatMap((space): WorldObjectNode[] => [
      space,
      ...space.children,
    ]),
  ]);
  return {
    ...world,
    hosts,
    spaces,
    leaves,
    nodes,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
  };
}

export function worldObjectWithWatches(
  world: WorldObject,
  watches: readonly {
    connectionId: string;
    generation: number;
    terminalId: string;
  }[],
): WorldObject {
  const keys = new Set(
    watches.map(({ connectionId, generation, terminalId }) =>
      JSON.stringify([connectionId, generation, terminalId]),
    ),
  );
  const hosts = world.hosts.map((host) => ({
    ...host,
    spaces: host.spaces.map((space) => ({
      ...space,
      children: space.children.map((leaf) =>
        keys.has(
          JSON.stringify([leaf.connectionId, leaf.generation, leaf.terminalId]),
        )
          ? { ...leaf, watched: true }
          : leaf,
      ),
    })),
  }));
  const spaces = hosts.flatMap((host) => host.spaces);
  const leaves = spaces.flatMap((space) => space.children);
  const nodes: WorldObjectNode[] = hosts.flatMap((host) => [
    host,
    ...host.spaces.flatMap((space): WorldObjectNode[] => [
      space,
      ...space.children,
    ]),
  ]);
  return {
    ...world,
    hosts,
    spaces,
    leaves,
    nodes,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
  };
}
