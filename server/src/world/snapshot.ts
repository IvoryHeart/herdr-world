import { groupHostSnapshots } from "./host-snapshots";
import type {
  WorldAgentStatus,
  WorldAgentStatusCounts,
  WorldSnapshotPriority,
  WorldWorkspaceCoverage,
  WorldSnapshotCoverage,
  WorldSnapshot,
  WorldConnectionSnapshot,
  WorldSnapshotResult,
} from "./snapshot-types";
export type {
  WorldSnapshotPriority,
  WorldWorkspaceCoverage,
  WorldSnapshotCoverage,
  WorldSnapshot,
  WorldWatchAdmission,
  WorldConnectionSnapshot,
  WorldSnapshotResult,
  WorldHostSnapshot,
} from "./snapshot-types";
import { parseSnapshotParameters } from "./snapshot-parameters";
import { WorldObservation, parseObservationBase } from "./observation-v1";
import * as observation from "./snapshot-observers";
import { nativeId, priorityKey } from "./snapshot-identity";
import {
  readRuntimeSnapshot,
  type RuntimeReader,
} from "../adapters/runtime-ports";
import { createHash } from "node:crypto";
import { sanitizeConnectionError } from "../connections/manager";
import type { ConnectionId } from "../connections/types";
import type { WorldWatchlist } from "./watchlist";
import type { WorldRuntimeStatus } from "./runtime-registry";
import type { WorldHost } from "../../../shared/hosts";

const MAX_WORKSPACES = 512;
const MAX_TABS = 2_048;
const MAX_PANES = 4_096;
const MAX_AGENTS = 4_096;
const MAX_CONCURRENT_CONNECTIONS = 4;
const SNAPSHOT_RESPONSE_DEADLINE_MS = 20_000;
const SNAPSHOT_FRESH_MS = 15_000;
const MAX_PRESENTED_SPACES = 128;
const MAX_PRESENTED_TABS_PER_SPACE = 8;
const MAX_PRESENTED_LEAVES_PER_SPACE = 16;

type RuntimeWithOperations = { operations: RuntimeReader };

type RuntimeLease<Runtime> = {
  connectionId: ConnectionId;
  generation: number;
  runtime: Runtime;
  isCurrent(): boolean;
};

type Registry<Runtime> = {
  list(): WorldRuntimeStatus[];
  hosts?(): WorldHost[];
  readyRuntimeLease(connectionId: ConnectionId): RuntimeLease<Runtime> | null;
};

type CachedSnapshot = {
  generation: number;
  snapshot: WorldSnapshot;
  rawDigest: string;
  priorityKey: string;
  watchRevision: number;
  freshUntil: number;
  dirty: boolean;
  /** Every room the admitted read returned, before any view bound. */
  rooms: readonly Record<string, unknown>[];
  /** The admitted read this entry holds, and its raw result. */
  readNumber: number;
  raw: RawHostSnapshot;
};

/**
 * An admitted read: it began at the host's current epoch, on the current
 * generation, after every read already applied. Commands settle only here.
 */
export type AdmittedRead = {
  connectionId: string;
  generation: number;
  /** The host epoch the read began in (its invalidation version). */
  epoch: number;
  rooms: readonly Record<string, unknown>[];
};

/** World's own published values beside topology, under the same revision. */
export type WorldPublished = Record<string, unknown>;

type RawHostSnapshot = readonly [unknown, unknown, unknown, unknown];
type HostOutcome = { raw: RawHostSnapshot } | { error: string };
type HostWork<Runtime> = {
  status: WorldRuntimeStatus;
  lease: RuntimeLease<Runtime>;
  priorities: readonly WorldSnapshotPriority[];
  invalidationVersion: number;
  activityVersion: number;
  /** Order of the read's start across the service; set when it runs. */
  readNumber: number;
  selected: boolean;
  state: "queued" | "running";
  late: boolean;
  promise: Promise<HostOutcome>;
  resolve(outcome: HostOutcome): void;
};

function records(value: unknown, key: string) {
  const records = (value as Record<string, unknown> | null)?.[key];
  if (!Array.isArray(records)) return [];
  return records.filter(
    (record): record is Record<string, unknown> =>
      !!record && typeof record === "object" && !Array.isArray(record),
  );
}

function boundedRecords(
  records: readonly Record<string, unknown>[],
  limit: number,
  priority: (record: Record<string, unknown>) => boolean,
) {
  if (records.length <= limit) return [...records];
  const admitted = new Set(
    [
      ...records.filter(priority),
      ...records.filter((record) => !priority(record)),
    ].slice(0, limit),
  );
  return records.filter((record) => admitted.has(record));
}

function rankedRelevantRecords(
  records: readonly Record<string, unknown>[],
  relevance: (record: Record<string, unknown>) => readonly number[],
) {
  return records
    .map((record, index) => ({ record, index, relevance: relevance(record) }))
    .sort((left, right) => {
      const dimensions = Math.max(
        left.relevance.length,
        right.relevance.length,
      );
      for (let index = 0; index < dimensions; index += 1) {
        const difference =
          (right.relevance[index] ?? 0) - (left.relevance[index] ?? 0);
        if (difference !== 0) return difference;
      }
      return left.index - right.index;
    })
    .map(({ record }) => record);
}

function boundedReservedRelevantRecords(
  records: readonly Record<string, unknown>[],
  limit: number,
  reserved: ReadonlySet<Record<string, unknown>>,
  relevance: (record: Record<string, unknown>) => readonly number[],
  group?: (record: Record<string, unknown>) => string | null,
  reservedGroups?: ReadonlySet<string>,
  reservationLimit = 0,
) {
  const admitted = new Set<Record<string, unknown>>([...reserved]);
  const ranked = rankedRelevantRecords(records, relevance);
  if (group && reservedGroups && reservationLimit > 0) {
    const groupCounts = new Map<string, number>();
    for (const record of ranked) {
      if (admitted.has(record)) continue;
      const groupId = group(record);
      if (!groupId || !reservedGroups.has(groupId)) continue;
      const count = groupCounts.get(groupId) ?? 0;
      if (count >= reservationLimit || admitted.size >= limit) continue;
      admitted.add(record);
      groupCounts.set(groupId, count + 1);
    }
  }
  for (const record of ranked) {
    if (admitted.size >= limit) break;
    admitted.add(record);
  }
  return records.filter((record) => admitted.has(record));
}

function runtimeOf(status: WorldRuntimeStatus) {
  return status.runtime === "herdr-core" ? { runtime: status.runtime } : {};
}

function emptyStatusCounts(): WorldAgentStatusCounts {
  return { working: 0, idle: 0, blocked: 0, done: 0, unknown: 0 };
}

function agentStatus(value: unknown): WorldAgentStatus {
  if (value === "working" || value === "busy" || value === "running") {
    return "working";
  }
  if (value === "idle" || value === "waiting") return "idle";
  if (value === "blocked" || value === "error") return "blocked";
  if (value === "done" || value === "completed") return "done";
  return "unknown";
}

function isAgentPane(pane: Record<string, unknown>) {
  return typeof pane.agent === "string" && pane.agent.trim().length > 0;
}

function paneStatusPriority(pane: Record<string, unknown>) {
  const status = agentStatus(pane.agent_status);
  return status === "blocked"
    ? 3
    : status === "working"
      ? 2
      : status === "done"
        ? 1
        : 0;
}

type PaneParentRelevance = {
  focused: boolean;
  attention: boolean;
  agentCount: number;
};

function paneParentRelevance(
  panes: readonly Record<string, unknown>[],
  parentKey: "workspace_id" | "tab_id",
) {
  const result = new Map<string, PaneParentRelevance>();
  for (const pane of panes) {
    const parentId = nativeId(pane[parentKey]);
    if (!parentId) continue;
    const current = result.get(parentId) ?? {
      focused: false,
      attention: false,
      agentCount: 0,
    };
    current.focused ||= pane.focused === true;
    current.attention ||= paneStatusPriority(pane) > 0;
    if (isAgentPane(pane)) current.agentCount += 1;
    result.set(parentId, current);
  }
  return result;
}

function topologyCoverage(
  workspaces: readonly Record<string, unknown>[],
  tabs: readonly Record<string, unknown>[],
  panes: readonly Record<string, unknown>[],
  retainedWorkspaces: readonly Record<string, unknown>[],
): WorldSnapshotCoverage {
  const status = emptyStatusCounts();
  let agentPanes = 0;
  const workspaceCounts = new Map<
    string,
    Omit<WorldWorkspaceCoverage, "workspace_id">
  >();
  for (const workspace of retainedWorkspaces) {
    const workspaceId = nativeId(workspace.workspace_id);
    if (workspaceId && !workspaceCounts.has(workspaceId)) {
      workspaceCounts.set(workspaceId, {
        tabs: 0,
        panes: 0,
        agent_panes: 0,
        status: emptyStatusCounts(),
      });
    }
  }
  for (const tab of tabs) {
    const workspaceId = nativeId(tab.workspace_id);
    const counts = workspaceId ? workspaceCounts.get(workspaceId) : undefined;
    if (counts) counts.tabs += 1;
  }
  for (const pane of panes) {
    const workspaceId = nativeId(pane.workspace_id);
    const counts = workspaceId ? workspaceCounts.get(workspaceId) : undefined;
    if (counts) counts.panes += 1;
    if (!isAgentPane(pane)) continue;
    agentPanes += 1;
    const semanticStatus = agentStatus(pane.agent_status);
    status[semanticStatus] += 1;
    if (counts) {
      counts.agent_panes += 1;
      counts.status[semanticStatus] += 1;
    }
  }
  return {
    workspaces: workspaces.length,
    tabs: tabs.length,
    panes: panes.length,
    agent_panes: agentPanes,
    status,
    by_workspace: [...workspaceCounts].map(([workspace_id, counts]) => ({
      workspace_id,
      ...counts,
    })),
  };
}

export class WorldSnapshotService<Runtime extends RuntimeWithOperations> {
  readonly observation: WorldObservation;
  private revision = 0;
  private readonly cache = new Map<string, CachedSnapshot>();
  private readonly projections = new WeakMap<
    RawHostSnapshot,
    Map<string, WorldSnapshot>
  >();
  private readonly invalidationVersions = new Map<string, number>();
  private readonly activityVersions = new Map<string, number>();
  private readonly workByConnection = new Map<string, HostWork<Runtime>>();
  private readonly queue: HostWork<Runtime>[] = [];
  private readonly lateInvalidations = new Map<string, number>();
  private active = 0;
  private activeInactive = 0;
  private enqueuing = false;
  private priorityStarts = 0;
  private priorityRotation = 0;
  private backgroundRotation = 0;
  private lateInvalidationScheduled = false;
  private readNumber = 0;
  /** Per host, the newest read applied to the cache (the epoch fence). */
  private readonly lastApplied = new Map<string, number>();
  private admittedReadHook?: (read: AdmittedRead) => boolean;
  private publishedValues?: () => Promise<WorldPublished> | WorldPublished;
  /** The admitted read each built connection shows (none: no snapshot). */
  private readonly sourceReads = new WeakMap<
    WorldConnectionSnapshot,
    number | undefined
  >();

  constructor(
    private readonly registry: Registry<Runtime>,
    private readonly now: () => number = Date.now,
    private readonly onLateObservation?: (
      connectionId: string,
      generation: number,
    ) => void,
    private readonly responseDeadlineMs = SNAPSHOT_RESPONSE_DEADLINE_MS,
    private readonly watchlist: () => WorldWatchlist = () => ({
      revision: 0,
      records: [],
    }),
    private readonly onFreshObservation?: observation.Fresh,
    private readonly onCompleteObservation?: observation.Complete,
    incarnation?: string,
  ) {
    this.observation = new WorldObservation(incarnation);
  }

  /**
   * The values World publishes beside topology (settings, commands). Read
   * after the revision is taken, so a reply's values are at least that new.
   */
  publishWith(values: () => Promise<WorldPublished> | WorldPublished) {
    this.publishedValues = values;
  }

  /** Called on each admitted read; true when it changed a published value. */
  onAdmittedRead(hook: (read: AdmittedRead) => boolean) {
    this.admittedReadHook = hook;
  }

  /** A published value beside topology changed: advance the revision. */
  publish(): number {
    this.revision += 1;
    return this.revision;
  }

  /** The host's epoch: reads that began before it are never applied. */
  epoch(connectionId: string): number {
    return this.invalidationVersions.get(connectionId) ?? 0;
  }

  /** Rooms from the newest admitted read of this generation, if any. */
  rooms(
    connectionId: string,
    generation: number,
  ): readonly Record<string, unknown>[] | null {
    const cached = this.cache.get(connectionId);
    return cached && cached.generation === generation ? cached.rooms : null;
  }

  /** Activity refreshes the cache without rejecting a read; late results only notify. */
  invalidate(connectionId?: string, kind?: "activity" | "late"): number {
    this.revision += 1;
    if (connectionId && kind !== "late") {
      const versions =
        kind === "activity" ? this.activityVersions : this.invalidationVersions;
      versions.set(connectionId, (versions.get(connectionId) ?? 0) + 1);
      const cached = this.cache.get(connectionId);
      if (cached) cached.dirty = true;
    }
    return this.revision;
  }

  async snapshot(params?: unknown): Promise<WorldSnapshotResult> {
    parseObservationBase(params);
    const {
      priorities: requestedPriorities,
      selectedConnectionId,
      priorityConnectionIds,
    } = parseSnapshotParameters(params);
    // The profile store bounds the managed catalogue. Preserve that complete
    // candidate set here so each view can apply its own relevance-aware bound.
    const statuses = this.registry.list();
    if (
      selectedConnectionId &&
      !statuses.some(({ id }) => id === selectedConnectionId)
    ) {
      throw new Error("unknown selected World connection");
    }
    const managedIds = new Set(statuses.map(({ id }) => id));
    const priorities = requestedPriorities.filter((priority) =>
      managedIds.has(priority.connection_id),
    );
    const priorityIds = new Set([
      ...priorityConnectionIds.filter((id) => managedIds.has(id)),
      ...(selectedConnectionId ? [selectedConnectionId] : []),
      ...priorities.map((priority) => priority.connection_id),
    ]);
    for (const cachedId of this.cache.keys()) {
      if (!managedIds.has(cachedId)) this.cache.delete(cachedId);
    }
    for (const invalidatedId of this.invalidationVersions.keys()) {
      if (!managedIds.has(invalidatedId)) {
        this.invalidationVersions.delete(invalidatedId);
      }
    }
    for (const activeId of this.activityVersions.keys()) {
      if (!managedIds.has(activeId)) this.activityVersions.delete(activeId);
    }
    for (const appliedId of this.lastApplied.keys()) {
      if (!managedIds.has(appliedId)) this.lastApplied.delete(appliedId);
    }
    const rotate = (group: typeof statuses, cursor: number) => {
      const offset = group.length ? cursor % group.length : 0;
      return [...group.slice(offset), ...group.slice(0, offset)];
    };
    const hinted = priorityIds.size > 0;
    const ordered = [
      ...rotate(
        statuses.filter((status) => priorityIds.has(status.id)),
        hinted ? this.priorityRotation : 0,
      ),
      ...rotate(
        statuses.filter((status) => !priorityIds.has(status.id)),
        hinted ? this.backgroundRotation : 0,
      ),
    ];
    const work = new Map<string, HostWork<Runtime> | null>();
    const completed = new Map<string, WorldConnectionSnapshot>();
    let scheduledNewWork = false;
    this.enqueuing = true;
    try {
      for (const status of ordered) {
        const fresh = this.freshCachedConnection(status, priorities);
        if (fresh) {
          completed.set(status.id, fresh);
          work.set(status.id, null);
          continue;
        }
        const previous = this.workByConnection.get(status.id);
        const observation = this.workFor(
          status,
          priorities,
          priorityIds.has(status.id),
        );
        if (observation && observation !== previous) scheduledNewWork = true;
        work.set(status.id, observation);
      }
    } finally {
      this.enqueuing = false;
      this.drain();
    }
    // Coalesced and cached requests do not consume another fair scheduling turn.
    if (hinted && scheduledNewWork) {
      this.priorityRotation++;
      this.backgroundRotation++;
    }

    let accepting = true;
    const observations = statuses.map(async (status) => {
      if (completed.has(status.id)) return;
      const hostWork = work.get(status.id);
      const connection = hostWork
        ? await this.observe(status, hostWork, priorities)
        : this.fallback(status);
      if (accepting) completed.set(status.id, connection);
    });
    let deadline: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(observations),
      new Promise<void>((resolve) => {
        deadline = setTimeout(resolve, this.responseDeadlineMs);
      }),
    ]);
    accepting = false;
    if (deadline) clearTimeout(deadline);
    const gathered = statuses.map((status) => {
      const connection = completed.get(status.id);
      if (connection) return connection;
      const hostWork = work.get(status.id);
      if (hostWork) hostWork.late = true;
      return this.fallback(status, "observation deadline exceeded");
    });
    // One coherent publication: the revision is taken first, World's own
    // values are read after it, and every host is then brought up to the
    // newest admitted read, all with no await in between. Each value is
    // therefore at least as new as the revision it is published under, so a
    // value a browser already adopted is never published again as older data
    // under a newer revision.
    let revision = this.revision;
    let published: WorldPublished = {};
    for (let attempt = 0; this.publishedValues; attempt++) {
      revision = this.revision;
      published = await this.publishedValues();
      if (this.revision === revision || attempt >= 3) break;
    }
    const connections = this.newest(gathered, priorities);
    return {
      ...published,
      revision,
      observed_at: this.now(),
      connections,
      ...(this.registry.hosts
        ? { hosts: groupHostSnapshots(this.registry.hosts(), connections) }
        : {}),
    };
  }

  private freshCachedConnection(
    status: WorldRuntimeStatus,
    priorities: readonly WorldSnapshotPriority[],
  ): WorldConnectionSnapshot | null {
    const cached = this.cache.get(status.id);
    if (
      status.state !== "ready" ||
      !cached ||
      cached.generation !== status.generation ||
      cached.dirty ||
      this.now() >= cached.freshUntil ||
      cached.priorityKey !== priorityKey(status.id, priorities) ||
      cached.watchRevision !== this.watchlist().revision
    ) {
      return null;
    }
    try {
      const lease = this.registry.readyRuntimeLease(status.id);
      if (
        !lease ||
        lease.generation !== status.generation ||
        !lease.isCurrent()
      ) {
        return null;
      }
    } catch {
      return null;
    }
    return this.sourced(
      {
        connection_id: status.id,
        label: status.label,
        source: status.source,
        ...runtimeOf(status),
        is_default: status.is_default,
        state: status.state,
        generation: status.generation,
        snapshot_generation: status.generation,
        stale: false,
        actionable: true,
        snapshot: cached.snapshot,
      },
      cached.readNumber,
    );
  }

  private sourced(connection: WorldConnectionSnapshot, read?: number) {
    this.sourceReads.set(connection, read);
    return connection;
  }

  /**
   * Bring each gathered connection up to its host's newest admitted read and
   * current registry state, so a reply never combines a host's older read
   * with a revision (or a settled command) that a newer read produced.
   */
  private newest(
    gathered: readonly WorldConnectionSnapshot[],
    priorities: readonly WorldSnapshotPriority[],
  ): WorldConnectionSnapshot[] {
    const statuses = new Map(
      this.registry.list().map((status) => [status.id, status]),
    );
    return gathered.flatMap((connection) => {
      const status = statuses.get(connection.connection_id);
      if (!status) return [];
      const cached = this.cache.get(status.id);
      const sameRead = this.sourceReads.get(connection) === cached?.readNumber;
      const sameStatus =
        status.generation === connection.generation &&
        status.state === connection.state &&
        status.label === connection.label;
      if (sameRead && sameStatus) return [connection];
      if (!connection.actionable)
        return [
          this.fallback(
            status,
            typeof connection.snapshot_error === "string"
              ? connection.snapshot_error
              : undefined,
          ),
        ];
      let lease: RuntimeLease<Runtime> | null;
      try {
        lease = this.registry.readyRuntimeLease(status.id);
      } catch {
        lease = null;
      }
      if (
        status.state !== "ready" ||
        !cached ||
        cached.generation !== status.generation ||
        !lease ||
        lease.generation !== status.generation ||
        !lease.isCurrent()
      )
        return [this.fallback(status, "connection changed during snapshot")];
      return [
        this.sourced(
          {
            connection_id: status.id,
            label: status.label,
            source: status.source,
            ...runtimeOf(status),
            is_default: status.is_default,
            state: status.state,
            generation: status.generation,
            snapshot_generation: status.generation,
            stale: false,
            actionable: true,
            snapshot: this.projectSnapshot(
              status,
              cached.raw,
              priorities,
              this.watchlist(),
            ),
          },
          cached.readNumber,
        ),
      ];
    });
  }

  private workFor(
    status: WorldRuntimeStatus,
    priorities: readonly WorldSnapshotPriority[],
    selected: boolean,
  ): HostWork<Runtime> | null {
    let lease: RuntimeLease<Runtime> | null;
    try {
      lease = this.registry.readyRuntimeLease(status.id);
    } catch {
      return null;
    }
    if (!lease || lease.generation !== status.generation) return null;
    const existing = this.workByConnection.get(status.id);
    if (
      existing &&
      existing.lease.generation === lease.generation &&
      existing.lease.runtime === lease.runtime &&
      existing.lease.isCurrent()
    ) {
      if (existing.state === "queued" && selected && !existing.selected) {
        existing.selected = true;
        this.drain();
      }
      return existing;
    }
    if (existing?.state === "queued") {
      const queuedIndex = this.queue.indexOf(existing);
      if (queuedIndex >= 0) this.queue.splice(queuedIndex, 1);
      existing.resolve({ error: "connection changed during snapshot" });
    }
    let resolve!: (outcome: HostOutcome) => void;
    const promise = new Promise<HostOutcome>((done) => {
      resolve = done;
    });
    const work: HostWork<Runtime> = {
      status,
      lease,
      priorities,
      invalidationVersion: this.invalidationVersions.get(status.id) ?? 0,
      activityVersion: this.activityVersions.get(status.id) ?? 0,
      readNumber: 0,
      selected,
      state: "queued",
      late: false,
      promise,
      resolve,
    };
    this.workByConnection.set(status.id, work);
    this.queue.push(work);
    this.drain();
    return work;
  }

  private drain() {
    if (this.enqueuing) return;
    while (this.active < MAX_CONCURRENT_CONNECTIONS) {
      const selectedIndex = this.queue.findIndex((work) => work.selected);
      const backgroundIndex = this.queue.findIndex((work) => !work.selected);
      const backgroundAvailable =
        this.activeInactive <
        (selectedIndex >= 0 || this.active > this.activeInactive
          ? MAX_CONCURRENT_CONNECTIONS - 1
          : MAX_CONCURRENT_CONNECTIONS);
      const index =
        selectedIndex >= 0 &&
        (this.priorityStarts < 3 || backgroundIndex < 0 || !backgroundAvailable)
          ? selectedIndex
          : backgroundIndex >= 0 && backgroundAvailable
            ? backgroundIndex
            : selectedIndex;
      if (index < 0 || this.queue.length === 0) {
        return;
      }
      const [work] = this.queue.splice(index, 1);
      if (
        this.workByConnection.get(work.status.id) !== work ||
        !work.lease.isCurrent()
      ) {
        if (this.workByConnection.get(work.status.id) === work) {
          this.workByConnection.delete(work.status.id);
        }
        work.resolve({ error: "connection changed during snapshot" });
        continue;
      }
      work.state = "running";
      this.priorityStarts = work.selected ? this.priorityStarts + 1 : 0;
      this.active += 1;
      if (!work.selected) this.activeInactive += 1;
      void this.runWork(work);
    }
  }

  private async runWork(work: HostWork<Runtime>) {
    const observedAt = this.now();
    work.readNumber = ++this.readNumber;
    let outcome: HostOutcome;
    try {
      const raw: RawHostSnapshot = await readRuntimeSnapshot(
        work.lease.runtime.operations,
      );
      // An expired catalogue can complete every downstream read immediately.
      // Break that microtask chain before host projection/digest work so native
      // terminal input and socket replies get an ordinary event-loop turn.
      // Revalidate the lease after yielding before publishing any topology.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!this.current(work)) {
        outcome = { error: "connection changed during snapshot" };
      } else if (!this.admitted(work)) {
        // The epoch fence: a read that began before the host's last change,
        // or before a read already applied, never replaces what is published.
        // A fresh read follows.
        this.queueLateInvalidation(work.status.id, work.lease.generation);
        outcome = { raw };
      } else {
        this.lastApplied.set(work.status.id, work.readNumber);
        const snapshot = this.projectSnapshot(
          work.status,
          raw,
          work.priorities,
          this.watchlist(),
        );
        const rawDigest = createHash("sha256")
          .update(JSON.stringify(raw))
          .digest("hex");
        const previous = this.cache.get(work.status.id);
        const changed =
          previous?.generation !== work.lease.generation ||
          previous.rawDigest !== rawDigest;
        const rooms = records(raw[0], "workspaces");
        this.cache.set(work.status.id, {
          generation: work.lease.generation,
          snapshot,
          rawDigest,
          priorityKey: priorityKey(work.status.id, work.priorities),
          watchRevision: this.watchlist().revision,
          freshUntil: this.now() + SNAPSHOT_FRESH_MS,
          dirty:
            (this.activityVersions.get(work.status.id) ?? 0) !==
            work.activityVersion,
          rooms,
          readNumber: work.readNumber,
          raw,
        });
        observation.complete(
          this.onCompleteObservation,
          work.lease,
          raw[2],
          observedAt,
        );
        this.onFreshObservation?.(
          work.status.id,
          work.lease.generation,
          snapshot.panes,
          observedAt,
          snapshot.agents,
          { workspaces: snapshot.workspaces, tabs: snapshot.tabs },
        );
        // A changed value, or a command settled by this read, is published
        // under a new revision even when the topology itself is unchanged.
        const settled =
          this.admittedReadHook?.({
            connectionId: work.status.id,
            generation: work.lease.generation,
            epoch: work.invalidationVersion,
            rooms,
          }) === true;
        if (changed || settled) this.revision += 1;
        if (work.late && changed) {
          this.queueLateInvalidation(work.status.id, work.lease.generation);
        }
        outcome = { raw };
      }
    } catch (error) {
      outcome = { error: sanitizeConnectionError(error) };
    }
    work.resolve(outcome);
    this.active -= 1;
    if (!work.selected) this.activeInactive -= 1;
    if (this.workByConnection.get(work.status.id) === work) {
      this.workByConnection.delete(work.status.id);
    }
    this.drain();
  }

  /** The per-host epoch fence (openspec world-one-object, task 4.2). */
  private admitted(work: HostWork<Runtime>) {
    return (
      !this.wasInvalidatedSinceStart(work) &&
      work.readNumber > (this.lastApplied.get(work.status.id) ?? 0)
    );
  }

  private current(work: HostWork<Runtime>) {
    return (
      work.lease.isCurrent() &&
      this.registry
        .list()
        .some(
          ({ id, generation, state }) =>
            id === work.status.id &&
            generation === work.lease.generation &&
            state === "ready",
        )
    );
  }

  private wasInvalidatedSinceStart(work: HostWork<Runtime>) {
    return (
      (this.invalidationVersions.get(work.status.id) ?? 0) !==
      work.invalidationVersion
    );
  }

  private queueLateInvalidation(connectionId: string, generation: number) {
    if (!this.onLateObservation) return;
    this.lateInvalidations.set(connectionId, generation);
    if (this.lateInvalidationScheduled) return;
    this.lateInvalidationScheduled = true;
    queueMicrotask(() => {
      this.lateInvalidationScheduled = false;
      for (const [id, observedGeneration] of this.lateInvalidations) {
        if (
          this.registry
            .list()
            .some(
              ({ id: currentId, generation: currentGeneration, state }) =>
                currentId === id &&
                currentGeneration === observedGeneration &&
                state === "ready",
            )
        ) {
          this.onLateObservation?.(id, observedGeneration);
        }
      }
      this.lateInvalidations.clear();
    });
  }

  private async observe(
    status: WorldRuntimeStatus,
    work: HostWork<Runtime>,
    priorities: readonly WorldSnapshotPriority[],
  ): Promise<WorldConnectionSnapshot> {
    const outcome = await work.promise;
    if ("error" in outcome) return this.fallback(status, outcome.error);
    if (!this.current(work)) {
      return this.fallback(status, "connection changed during snapshot");
    }
    if (
      this.wasInvalidatedSinceStart(work) ||
      this.lastApplied.get(status.id) !== work.readNumber
    ) {
      return this.fallback(status, "observation changed during snapshot");
    }
    return this.sourced(
      {
        connection_id: status.id,
        label: status.label,
        source: status.source,
        ...runtimeOf(status),
        is_default: status.is_default,
        state: status.state,
        generation: work.lease.generation,
        snapshot_generation: work.lease.generation,
        stale: false,
        actionable: true,
        snapshot: this.projectSnapshot(
          status,
          outcome.raw,
          priorities,
          this.watchlist(),
        ),
      },
      work.readNumber,
    );
  }

  private fallback(
    status: WorldRuntimeStatus,
    snapshotError?: string,
  ): WorldConnectionSnapshot {
    const cached = this.cache.get(status.id);
    return this.sourced(
      {
        connection_id: status.id,
        label: status.label,
        source: status.source,
        ...runtimeOf(status),
        is_default: status.is_default,
        state: status.state,
        generation: status.generation,
        snapshot_generation: cached?.generation ?? null,
        stale: Boolean(cached),
        actionable: false,
        ...(status.error ? { error: status.error } : {}),
        ...(snapshotError ? { snapshot_error: snapshotError } : {}),
        snapshot: cached?.snapshot ?? null,
      },
      cached?.readNumber,
    );
  }

  private projectSnapshot(
    status: WorldRuntimeStatus,
    raw: RawHostSnapshot,
    priorities: readonly WorldSnapshotPriority[],
    watchlist: WorldWatchlist,
  ): WorldSnapshot {
    const key = JSON.stringify([
      status.id,
      status.generation,
      priorityKey(status.id, priorities),
      watchlist.revision,
    ]);
    let projections = this.projections.get(raw);
    const cached = projections?.get(key);
    if (cached) return cached;
    if (!projections) this.projections.set(raw, (projections = new Map()));
    const [workspaceResult, tabResult, paneResult, agentResult] = raw;
    const connectionPriorities = priorities.filter(
      ({ connection_id }) => connection_id === status.id,
    );
    const allWorkspaces = records(workspaceResult, "workspaces");
    const allTabs = records(tabResult, "tabs");
    const allPanes = records(paneResult, "panes");
    const allAgents = records(agentResult, "agents");
    const watched = watchlist.records.filter(
      (watch) =>
        watch.connection_id === status.id &&
        watch.connection_generation === status.generation,
    );
    const workspacesById = new Map<string, Record<string, unknown>[]>();
    const tabsById = new Map<string, Record<string, unknown>[]>();
    for (const workspace of allWorkspaces) {
      const id = nativeId(workspace.workspace_id);
      if (id)
        workspacesById.set(id, [...(workspacesById.get(id) ?? []), workspace]);
    }
    for (const tab of allTabs) {
      const id = nativeId(tab.tab_id);
      if (id) tabsById.set(id, [...(tabsById.get(id) ?? []), tab]);
    }
    const matchedWatchedPanes = new Set<Record<string, unknown>>();
    const watchedWorkspaceIds = new Set<string>();
    const watchedTabIds = new Set<string>();
    let missing = 0;
    let unresolved = 0;
    for (const watch of watched) {
      const candidates = allPanes.filter(
        (pane) => pane.terminal_id === watch.terminal_id,
      );
      if (candidates.length === 0) {
        missing += 1;
        continue;
      }
      const pane = candidates.length === 1 ? candidates[0] : null;
      const workspaceId = pane && nativeId(pane.workspace_id);
      const tabId = pane && nativeId(pane.tab_id);
      const workspace = workspaceId
        ? workspacesById.get(workspaceId)
        : undefined;
      const tab = tabId ? tabsById.get(tabId) : undefined;
      if (
        !pane ||
        !nativeId(pane.pane_id) ||
        !workspaceId ||
        !tabId ||
        workspace?.length !== 1 ||
        tab?.length !== 1 ||
        tab[0].workspace_id !== workspaceId
      ) {
        unresolved += 1;
        continue;
      }
      matchedWatchedPanes.add(pane);
      watchedWorkspaceIds.add(workspaceId);
      watchedTabIds.add(tabId);
    }
    const matched = matchedWatchedPanes.size;
    const explicitPanes = allPanes.filter((pane) =>
      connectionPriorities.some(
        (priority) =>
          (priority.pane_id && priority.pane_id === pane.pane_id) ||
          (priority.terminal_id && priority.terminal_id === pane.terminal_id),
      ),
    );
    const priorityWorkspaceIds = new Set([
      ...connectionPriorities.map(({ workspace_id }) => workspace_id),
      ...explicitPanes.flatMap((pane) => {
        const workspaceId = nativeId(pane.workspace_id);
        return workspaceId ? [workspaceId] : [];
      }),
    ]);
    const workspaceRelevance = paneParentRelevance(allPanes, "workspace_id");
    const workspaceRelevanceTuple = (workspace: Record<string, unknown>) => {
      const workspaceId = nativeId(workspace.workspace_id);
      const relevance = workspaceId
        ? workspaceRelevance.get(workspaceId)
        : undefined;
      return [
        Number(Boolean(workspaceId && priorityWorkspaceIds.has(workspaceId))),
        Number(workspace.focused === true || relevance?.focused === true),
        Number(relevance?.attention === true),
        relevance?.agentCount ?? 0,
      ];
    };
    const workspaces = boundedReservedRelevantRecords(
      allWorkspaces,
      MAX_WORKSPACES,
      new Set(
        allWorkspaces.filter((workspace) =>
          watchedWorkspaceIds.has(String(workspace.workspace_id)),
        ),
      ),
      workspaceRelevanceTuple,
    );
    const retainedWorkspaceIds = new Set(
      workspaces.flatMap((workspace) => {
        const workspaceId = nativeId(workspace.workspace_id);
        return workspaceId ? [workspaceId] : [];
      }),
    );
    const presentedWorkspaceIds = new Set(
      rankedRelevantRecords(workspaces, workspaceRelevanceTuple)
        .slice(0, MAX_PRESENTED_SPACES)
        .flatMap((workspace) => {
          const workspaceId = nativeId(workspace.workspace_id);
          return workspaceId ? [workspaceId] : [];
        }),
    );
    const panesInRetainedWorkspaces = allPanes.filter((pane) =>
      retainedWorkspaceIds.has(String(pane.workspace_id)),
    );
    const paneIsExplicit = (pane: Record<string, unknown>) =>
      connectionPriorities.some(
        (priority) =>
          (priority.pane_id && priority.pane_id === pane.pane_id) ||
          (priority.terminal_id && priority.terminal_id === pane.terminal_id),
      );
    const paneRelevanceTuple = (pane: Record<string, unknown>) => [
      Number(matchedWatchedPanes.has(pane)),
      Number(paneIsExplicit(pane)),
      Number(pane.focused === true),
      paneStatusPriority(pane),
      Number(isAgentPane(pane)),
    ];
    const panes = boundedReservedRelevantRecords(
      panesInRetainedWorkspaces,
      MAX_PANES,
      new Set(
        panesInRetainedWorkspaces.filter((pane) =>
          matchedWatchedPanes.has(pane),
        ),
      ),
      paneRelevanceTuple,
      (pane) => nativeId(pane.workspace_id),
      presentedWorkspaceIds,
      MAX_PRESENTED_LEAVES_PER_SPACE,
    );
    const priorityTabIds = new Set(
      explicitPanes.flatMap((pane) => {
        const tabId = nativeId(pane.tab_id);
        return tabId ? [tabId] : [];
      }),
    );
    for (const workspace of workspaces) {
      const activeTabId = nativeId(workspace.active_tab_id);
      if (activeTabId) priorityTabIds.add(activeTabId);
    }
    const tabRelevance = paneParentRelevance(allPanes, "tab_id");
    const tabs = boundedReservedRelevantRecords(
      allTabs.filter((tab) =>
        retainedWorkspaceIds.has(String(tab.workspace_id)),
      ),
      MAX_TABS,
      new Set(allTabs.filter((tab) => watchedTabIds.has(String(tab.tab_id)))),
      (tab) => {
        const tabId = nativeId(tab.tab_id);
        const relevance = tabId ? tabRelevance.get(tabId) : undefined;
        return [
          Number(Boolean(tabId && priorityTabIds.has(tabId))),
          Number(tab.focused === true || relevance?.focused === true),
          Number(relevance?.attention === true),
          relevance?.agentCount ?? 0,
        ];
      },
      (tab) => nativeId(tab.workspace_id),
      presentedWorkspaceIds,
      MAX_PRESENTED_TABS_PER_SPACE,
    );
    const retainedPaneIds = new Set(
      panes.flatMap((pane) => {
        const paneId = nativeId(pane.pane_id);
        return paneId ? [paneId] : [];
      }),
    );
    const admitted = [...matchedWatchedPanes].filter((pane) =>
      panes.includes(pane),
    ).length;
    const snapshot: WorldSnapshot = {
      workspaces,
      tabs,
      panes,
      agents: boundedRecords(
        allAgents,
        MAX_AGENTS,
        (agent) =>
          retainedPaneIds.has(String(agent.pane_id)) ||
          connectionPriorities.some(
            (priority) =>
              (priority.pane_id && priority.pane_id === agent.pane_id) ||
              (priority.terminal_id &&
                priority.terminal_id === agent.terminal_id),
          ),
      ),
      coverage: topologyCoverage(allWorkspaces, allTabs, allPanes, workspaces),
      watch_admission: {
        revision: watchlist.revision,
        registered: watched.length,
        missing,
        unresolved,
        matched,
        admitted,
        admission_failed: matched - admitted,
      },
    };
    // Concurrent browsers may request distinct projections of the same acquired host.
    // Bound retained projection variants even if many sockets share one read.
    if (projections.size >= 64)
      projections.delete(projections.keys().next().value!);
    projections.set(key, snapshot);
    return snapshot;
  }
}
