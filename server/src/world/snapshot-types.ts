import type { ConnectionStatus } from "../connections/types";
import type { HostGrouping } from "../../../shared/hostGrouping";
import type { WorldHost } from "../../../shared/hosts";

export type WorldAgentStatus =
  | "working"
  | "idle"
  | "blocked"
  | "done"
  | "unknown";
export type WorldAgentStatusCounts = Record<WorldAgentStatus, number>;

export type WorldSnapshotPriority = {
  connection_id: string;
  workspace_id: string;
  pane_id?: string;
  terminal_id?: string;
};

export type WorldWorkspaceCoverage = {
  workspace_id: string;
  tabs: number;
  panes: number;
  agent_panes: number;
  status: WorldAgentStatusCounts;
};

export type WorldSnapshotCoverage = {
  workspaces: number;
  tabs: number;
  panes: number;
  agent_panes: number;
  status: WorldAgentStatusCounts;
  by_workspace: WorldWorkspaceCoverage[];
};

export type WorldSnapshot = {
  workspaces: Record<string, unknown>[];
  tabs: Record<string, unknown>[];
  panes: Record<string, unknown>[];
  agents: Record<string, unknown>[];
  coverage: WorldSnapshotCoverage;
  watch_admission: WorldWatchAdmission;
};

export type WorldWatchAdmission = {
  revision: number;
  registered: number;
  missing: number;
  unresolved: number;
  matched: number;
  admitted: number;
  admission_failed: number;
};

export type WorldConnectionSnapshot = {
  connection_id: string;
  label: string;
  source: string;
  /** Present only for herdr-core: its agents are observed, not controlled. */
  runtime?: "herdr-core";
  is_default: boolean;
  state: ConnectionStatus["state"];
  generation: number;
  snapshot_generation: number | null;
  stale: boolean;
  actionable: boolean;
  error?: { message: string };
  snapshot_error?: string;
  snapshot: WorldSnapshot | null;
};

/**
 * One World agent (openspec world-agent-identity): its store-issued ID,
 * derived state, observed labels, conversation and seat. Ended agents stay
 * in the store and are not published.
 */
export type WorldAgentEntry = {
  agent_id: string;
  state: "live" | "away" | "unresolved" | "ended";
  harness: string;
  folder: string | null;
  /** The seat's runtime name while live; World stores no name yet. */
  name: string | null;
  conversation: {
    state: "known" | "unknown" | "conflict";
    /** `<harness>/<conversation ID>`. */
    item: string | null;
  };
  seat: {
    connection_id: string;
    terminal_id: string;
    pane_id?: string;
    tab_id?: string;
    workspace_id?: string;
  } | null;
};

export type WorldSnapshotResult = {
  revision: number;
  observed_at: number;
  connections: WorldConnectionSnapshot[];
  /** World's agents under this revision; terminal rows carry `agent_id`. */
  agents?: WorldAgentEntry[];
  /** Host catalogue; runtime topology remains indexed by immutable connection_id. */
  hosts?: WorldHostSnapshot[];
  /** How every view groups the runtimes, derived under this revision. */
  host_grouping?: HostGrouping;
};

export type WorldHostSnapshot = Omit<WorldHost, "runtimes"> & {
  runtimes: (WorldHost["runtimes"][number] & {
    snapshot_generation: number | null;
    stale: boolean;
    actionable: boolean;
  })[];
};

/** World's own published values beside topology, under the same revision. */
export type WorldPublished = Record<string, unknown>;

/**
 * World's own values: read after the revision is taken, so a reply's values
 * are at least that new. `derive` adds, with no await, what follows from the
 * values and connections that one reply carries, so they match exactly.
 */
export type WorldPublication = {
  values(): Promise<WorldPublished> | WorldPublished;
  derive?(
    published: WorldPublished,
    connections: readonly WorldConnectionSnapshot[],
  ): WorldPublished;
  /**
   * The reply's connections as published: the same ones, with terminal rows
   * attributed (`agent_id`). Copies; cached snapshots are never changed.
   */
  attribute?(connections: readonly WorldConnectionSnapshot[]): {
    agents: WorldAgentEntry[];
    connections: WorldConnectionSnapshot[];
  };
};
