import type {
  TerminalMarksPort,
  SavedTerminalMark,
  MarkKind,
  MarkBody,
} from "../storage/terminal-marks";
import type { BindingFence, BindingEvent } from "./binding-types";
import {
  bindingObservationAmbiguous,
  resolveBinding,
} from "./binding-resolution";
import {
  admittedAgentPanes,
  deskSessionFingerprint,
  observeDeskPanes,
} from "./desk-observation";
import { WorldDeskRegistry, type StoredDeskRecord } from "./desk-state";
import {
  watchKey,
  WorldWatchlistRegistry,
  type WorldWatchRecord,
} from "./watchlist";
import { deskHistoryEvictions, estimateDeskWrite } from "./desk-retention";
import {
  legacyReviewCandidates,
  legacyReviewBudgetBody,
} from "./legacy-review-resolution";
import type { Scheduler } from "../service/ports";
import {
  terminalEntities,
  TerminalMarkObservationRefused,
} from "./terminal-mark-observation";

type Identity = Pick<
  WorldWatchRecord,
  "connection_id" | "connection_generation" | "terminal_id"
> & {
  agent_session_fingerprint?: string | null;
  watch_id?: string;
};
export type MarkRegistries = {
  desk: WorldDeskRegistry;
  watchlist: WorldWatchlistRegistry;
};
type Lease = {
  generation: number;
  isCurrent(): boolean;
  runtime: {
    herdr: {
      call(
        method: string,
        params: Record<string, unknown>,
        timeout: number,
      ): Promise<unknown>;
    };
  };
};
type Options = {
  storage: TerminalMarksPort;
  incarnation: string;
  registries: MarkRegistries;
  lease(connectionId: string): Lease | null | undefined;
  now(): number;
  scheduler?: Scheduler;
  changed(
    kind: MarkKind,
    revision: number,
    connectionId?: string,
    generation?: number,
  ): void;
  failed(error: unknown): void;
};
const key = (kind: MarkKind, terminal: string) =>
  JSON.stringify([kind, terminal]);
const revisions = (r: MarkRegistries) => [
  r.desk.list().revision,
  r.watchlist.list().revision,
];

/** Serial admission, committed publication, and unresolved restart captures. */
export class PersistentTerminalMarks {
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private closed = false;
  private runtimeEpoch = new Map<string, number>();
  // Live ownership only. Unknown-session captures cannot cross a runtime or
  // World restart; terminal reuse alone is never proof of agent continuity.
  private deskCaptures = new Map<string, string>();
  private deskRefusals = new Map<string, string>();
  private recoveringSources: Set<string>;
  private archiveTimer?: { cancel(): void };
  private armArchiveExpiry() {
    this.archiveTimer?.cancel();
    this.archiveTimer = undefined;
    const expiry = this.options.storage.archiveStatus().expires_at;
    if (this.closed || !this.options.scheduler || expiry === null) return;
    this.archiveTimer = this.options.scheduler.schedule(
      () => {
        this.archiveTimer = undefined;
        void this.expire()
          .catch(this.options.failed)
          .finally(() => this.armArchiveExpiry());
      },
      Math.min(60_000, Math.max(0, expiry - this.options.now())),
    );
  }
  assertDeskAvailable() {
    const refusal = this.deskRefusals.values().next().value;
    if (refusal) throw new Error(refusal);
  }
  private refuse(connectionId: string, generation: number, error: Error) {
    const changed = this.deskRefusals.get(connectionId) !== error.message;
    this.deskRefusals.set(connectionId, error.message);
    if (changed)
      this.options.changed(
        "desk",
        this.options.registries.desk.list().revision,
        connectionId,
        generation,
      );
  }
  private ownership = new Map<
    string,
    {
      connectionId: string;
      generation: number;
      terminal: string;
      known: boolean;
      present: boolean;
      session: string | null;
      token: object;
    }
  >();
  private watchCaptures = new Map<string, string | null>();
  private rememberWatch(record: WorldWatchRecord) {
    if (!record.watch_id) return;
    const key = watchKey(record),
      prior = this.watchCaptures.get(key);
    this.watchCaptures.set(
      key,
      prior === undefined || prior === record.watch_id ? record.watch_id : null,
    );
    while (this.watchCaptures.size > 4096)
      this.watchCaptures.delete(this.watchCaptures.keys().next().value!);
  }
  private recordOwner(
    identity: Identity,
    session: string | null,
    known = true,
    present = true,
  ) {
    const key = watchKey(identity),
      prior = this.ownership.get(key);
    if (
      prior &&
      prior.session === session &&
      prior.known === known &&
      prior.present === present
    )
      return prior;
    const owner = {
      connectionId: identity.connection_id,
      generation: identity.connection_generation,
      terminal: identity.terminal_id,
      known,
      present,
      session,
      token: {},
    };
    this.ownership.delete(key);
    this.ownership.set(key, owner);
    while (this.ownership.size > 8192)
      this.ownership.delete(this.ownership.keys().next().value!);
    return owner;
  }
  private admissions = new Set<{
    connectionId: string;
    generation: number;
    terminal: string;
    owner?: { key: string; token: object };
    valid: boolean;
  }>();
  constructor(private readonly options: Options) {
    this.recoveringSources = new Set(
      options.storage
        .list()
        .filter(
          (row) =>
            row.kind === "desk" &&
            row.binding.state !== "ended" &&
            row.binding.evidence.session,
        )
        .map((row) => row.binding.instance),
    );
    this.armArchiveExpiry();
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed || this.queued >= 256)
      return Promise.reject(new Error("terminal marks are closing or busy"));
    this.queued++;
    const task = this.tail.then(work);
    this.tail = task
      .then(
        () => {},
        () => {},
      )
      .finally(() => {
        this.queued--;
      });
    void this.tail.catch(() => {});
    return task;
  }
  async close() {
    this.closed = true;
    this.archiveTimer?.cancel();
    this.archiveTimer = undefined;
    await this.tail;
  }
  expire() {
    return this.enqueue(async () => {
      const at = this.options.now();
      const expiry = this.options.storage.archiveStatus().expires_at;
      if (
        !(expiry !== null && at >= expiry) &&
        !this.options.storage
          .list()
          .some(
            (row) =>
              row.kind === "desk" &&
              row.body.stopped_at != null &&
              at - row.body.stopped_at > 12 * 60 * 60_000,
          )
      )
        return;
      await this.options.storage.expire(at);
      const live = this.options.registries,
        draft = live.desk.fork(),
        before = revisions(live);
      draft.expire(at);
      live.desk.adopt(draft);
      this.publish(before);
      this.armArchiveExpiry();
    });
  }
  /** Runtime replacement hides the projection; saved identity waits for a fresh list. */
  retire(
    connectionId: string,
    generation: number,
    ready = true,
    recovering = false,
  ) {
    if (recovering) this.recoveringSources.add(connectionId);
    else this.recoveringSources.delete(connectionId);
    this.deskRefusals.delete(connectionId);
    for (const [key] of this.deskCaptures) {
      const [connection, capturedGeneration] = JSON.parse(key);
      if (
        connection === connectionId &&
        (!ready || capturedGeneration !== generation)
      )
        this.deskCaptures.delete(key);
    }
    if (!ready)
      this.runtimeEpoch.set(
        connectionId,
        (this.runtimeEpoch.get(connectionId) ?? 0) + 1,
      );
    for (const [key, owner] of this.ownership)
      if (
        owner.connectionId === connectionId &&
        (!ready || owner.generation !== generation)
      )
        this.ownership.delete(key);
    for (const guard of this.admissions)
      if (
        guard.connectionId === connectionId &&
        (!ready || guard.generation !== generation)
      )
        guard.valid = false;
    const r = this.options.registries,
      before = revisions(r);
    r.desk.retireConnectionGeneration(connectionId, ready ? generation : -1);
    r.watchlist.retireConnectionGeneration(
      connectionId,
      ready ? generation : -1,
    );
    this.publish(before, connectionId, generation);
    if (!this.closed)
      void this.enqueue(async () => {
        const rows = this.options.storage.list();
        const ids = new Set(this.deskCaptures.values());
        for (const row of rows)
          if (
            row.kind === "desk" &&
            row.binding.state !== "ended" &&
            row.binding.evidence.session &&
            this.recoveringSources.has(row.binding.instance)
          )
            ids.add(row.id);
        for (const row of deskHistoryEvictions(
          rows,
          rows.filter((row) => ids.has(row.id)),
        ))
          await this.options.storage.remove(row.id, row.revision);
      }).catch(this.options.failed);
  }
  observe(
    connectionId: string,
    generation: number,
    panes: readonly Record<string, unknown>[],
    at: number,
    agents: readonly Record<string, unknown>[] = [],
  ) {
    const observedLease = this.options.lease(connectionId);
    if (
      !observedLease ||
      observedLease.generation !== generation ||
      !observedLease.isCurrent() ||
      !this.options.registries.desk.canObserveConnection(
        connectionId,
        generation,
        at,
      )
    )
      return Promise.resolve();
    let entities;
    try {
      entities = terminalEntities(panes, {
        adapter: "herdr",
        instance: connectionId,
        generation,
        service_incarnation: this.options.incarnation,
      });
    } catch (error) {
      if (!(error instanceof TerminalMarkObservationRefused)) throw error;
      this.refuse(connectionId, generation, error);
      return Promise.resolve();
    }
    const epoch = this.runtimeEpoch.get(connectionId) ?? 0;
    const guards = [...this.admissions].filter(
      (guard) =>
        guard.connectionId === connectionId && guard.generation === generation,
    );
    const owners = [...this.ownership.values()].filter(
      (owner) =>
        owner.connectionId === connectionId && owner.generation === generation,
    );
    if (guards.length || owners.length) {
      const lease = this.options.lease(connectionId);
      if (lease?.generation === generation && lease.isCurrent()) {
        const ambiguous =
          entities.some((entity) => !entity.native_id) ||
          bindingObservationAmbiguous(entities);
        const byTerminal = new Map(
          entities.flatMap((entity) =>
            entity.terminals.map((terminal) => [terminal, entity] as const),
          ),
        );
        for (const owner of owners) {
          const entity = byTerminal.get(owner.terminal);
          if (ambiguous) owner.token = {};
          else
            this.recordOwner(
              {
                connection_id: connectionId,
                connection_generation: generation,
                terminal_id: owner.terminal,
              },
              entity?.session ?? null,
              true,
              Boolean(entity),
            );
        }
        for (const guard of guards) {
          const entity = byTerminal.get(guard.terminal);
          guard.valid &&=
            !ambiguous &&
            Boolean(entity) &&
            (!guard.owner ||
              this.ownership.get(guard.owner.key)?.token === guard.owner.token);
        }
      }
    }
    return this.enqueue(async () => {
      const lease = this.options.lease(connectionId);
      if (
        !lease ||
        lease.generation !== generation ||
        !lease.isCurrent() ||
        epoch !== (this.runtimeEpoch.get(connectionId) ?? 0)
      )
        return;
      await this.apply(
        connectionId,
        generation,
        panes,
        at,
        agents,
        () =>
          lease.isCurrent() &&
          epoch === (this.runtimeEpoch.get(connectionId) ?? 0),
      );
      this.deskRefusals.delete(connectionId);
    }).catch((error) => {
      const lease = this.options.lease(connectionId);
      if (
        lease?.generation === generation &&
        lease.isCurrent() &&
        epoch === (this.runtimeEpoch.get(connectionId) ?? 0)
      ) {
        if (
          error instanceof TerminalMarkObservationRefused ||
          (error instanceof Error &&
            error.message.startsWith("Desk capacity exceeded:"))
        ) {
          this.refuse(connectionId, generation, error);
        } else this.options.failed(error);
      }
    });
  }
  unpin(identity: Identity) {
    // Freeze the exact capture before waiting behind another admitted operation.
    const capture =
      identity.watch_id ?? this.watchCaptures.get(watchKey(identity));
    return this.enqueue(async () => {
      if (!capture) return;
      const row = this.options.storage
        .list()
        .find(
          (row) =>
            row.id === capture &&
            row.kind === "watchlist" &&
            row.binding.instance === identity.connection_id &&
            row.binding.evidence.terminals[0] === identity.terminal_id,
        );
      if (!row) return;
      await this.options.storage.remove(row.id, row.revision);
      const live = this.options.registries,
        before = revisions(live),
        draft = live.watchlist.fork();
      const removed = draft.removeCommittedCapture(row.id);
      const affected = removed.sort(
        (a, b) => b.connection_generation - a.connection_generation,
      )[0];
      live.watchlist.adopt(draft);
      this.publish(
        before,
        affected?.connection_id ?? identity.connection_id,
        affected?.connection_generation ?? identity.connection_generation,
      );
    });
  }
  /** The read is inside admission, so another admitted operation cannot overtake it. */
  mutate(
    identity: Identity,
    action: (
      draft: MarkRegistries,
      pane: Record<string, unknown>,
      at: number,
    ) => void,
    scope: "agent" | "terminal" = "agent",
  ) {
    return this.enqueue(async () => {
      const lease = this.options.lease(identity.connection_id);
      if (
        !lease ||
        lease.generation !== identity.connection_generation ||
        !lease.isCurrent()
      )
        throw new Error("terminal mark target is unavailable");
      const ownerKey = watchKey(identity);
      const observed = this.options.registries.desk.observedSession(identity);
      const initial = Object.hasOwn(identity, "agent_session_fingerprint")
        ? identity.agent_session_fingerprint
        : observed;
      const owner =
        scope === "agent"
          ? (this.ownership.get(ownerKey) ??
            this.recordOwner(identity, initial ?? null, initial !== undefined))
          : undefined;
      const guard = {
        connectionId: identity.connection_id,
        generation: identity.connection_generation,
        terminal: identity.terminal_id,
        ...(owner ? { owner: { key: ownerKey, token: owner.token } } : {}),
        valid: true,
      };
      this.admissions.add(guard);
      try {
        const result = (await lease.runtime.herdr.call(
          "pane.list",
          {},
          5_000,
        )) as { panes?: unknown };
        if (!Array.isArray(result?.panes) || !lease.isCurrent() || !guard.valid)
          throw new Error("terminal mark target changed during admission");
        const panes = result.panes as Record<string, unknown>[];
        const matches = panes.filter(
          (pane) => pane.terminal_id === identity.terminal_id,
        );
        if (matches.length !== 1)
          throw new Error("terminal mark target is ambiguous or absent");
        if (guard.owner)
          guard.owner.token = this.recordOwner(
            identity,
            deskSessionFingerprint(matches[0]!.agent_session),
          ).token;
        const at = this.options.now();
        await this.apply(
          identity.connection_id,
          identity.connection_generation,
          panes,
          at,
          [],
          () => lease.isCurrent() && guard.valid,
          (draft) => action(draft, matches[0]!, at),
        );
      } finally {
        this.admissions.delete(guard);
      }
    });
  }
  private publish(
    before: number[],
    connectionId?: string,
    generation?: number,
  ) {
    for (const watch of this.options.registries.watchlist.list().records)
      this.rememberWatch(watch);
    const after = revisions(this.options.registries);
    (["desk", "watchlist"] as const).forEach((kind, i) => {
      if (before[i] !== after[i])
        this.options.changed(kind, after[i]!, connectionId, generation);
    });
  }
  private async apply(
    connectionId: string,
    generation: number,
    panes: readonly Record<string, unknown>[],
    at: number,
    agents: readonly Record<string, unknown>[],
    isCurrent: () => boolean,
    action?: (draft: MarkRegistries) => void,
  ) {
    if (!isCurrent()) throw new Error("terminal mark runtime retired");
    if (
      !action &&
      !this.options.registries.desk.canObserveConnection(
        connectionId,
        generation,
        at,
      )
    )
      return;
    const fence: BindingFence = {
      adapter: "herdr",
      instance: connectionId,
      generation,
      service_incarnation: this.options.incarnation,
    };
    const entities = terminalEntities(panes, fence);
    const ambiguous =
      entities.some((entity) => !entity.native_id) ||
      bindingObservationAmbiguous(entities);
    if (action && ambiguous)
      throw new Error("terminal mark observation is ambiguous");
    const event: BindingEvent = {
      type: "listing",
      fence,
      complete: !ambiguous,
      entities,
    };
    const active = new Map<string, SavedTerminalMark>();
    const ended: SavedTerminalMark[] = [];
    const savedRows = this.options.storage.list();
    const savedById = new Map(savedRows.map((row) => [row.id, row]));
    const admitted = admittedAgentPanes(panes, agents);
    const legacy = !ambiguous
      ? await legacyReviewCandidates(
          this.options.storage,
          connectionId,
          panes,
          admitted,
          !action,
          isCurrent,
        )
      : { proofs: new Map(), resolvable: new Set<string>() };
    if (!isCurrent()) throw new Error("terminal mark runtime retired");
    const unknownOwners = new Set(
      admitted
        .filter((agent) => agent.session === null)
        .map((agent) => agent.terminalId),
    );
    for (const row of savedRows) {
      if (row.binding.instance !== connectionId) continue;
      if (row.kind === "desk") {
        if (row.binding.state === "ended") continue;
        const terminal = row.binding.evidence.terminals[0]!;
        const matches = entities.filter((entity) =>
          entity.terminals.includes(terminal),
        );
        const session = matches.length === 1 ? matches[0]!.session : undefined;
        if (
          !ambiguous &&
          row.binding.evidence.session &&
          unknownOwners.has(terminal)
        ) {
          ended.push(row);
          continue;
        }
        const captured = this.deskCaptures.get(
          watchKey({
            connection_id: connectionId,
            connection_generation: generation,
            terminal_id: terminal,
          }),
        );
        if (
          !row.binding.evidence.session &&
          (session !== undefined || captured !== row.id)
        )
          continue;
        // A live intervening owner is stronger evidence than an old capture,
        // even if its known fingerprint subsequently returns.
        if (
          row.binding.evidence.session &&
          session === row.binding.evidence.session &&
          captured &&
          captured !== row.id
        ) {
          ended.push(row);
          continue;
        }
      }
      const resolution = resolveBinding(row.binding, event, fence, at);
      if (resolution.binding.state === "ended") ended.push(row);
      else if (resolution.target)
        active.set(key(row.kind, row.binding.evidence.terminals[0]!), {
          ...row,
          binding: resolution.binding,
        });
    }
    const live = this.options.registries;
    const draft = {
      desk: live.desk.fork(),
      watchlist: live.watchlist.fork(),
    };
    const deskCaptures = new Map(this.deskCaptures);
    for (const [capture] of deskCaptures)
      if (JSON.parse(capture)[0] === connectionId) deskCaptures.delete(capture);
    const desk: StoredDeskRecord[] = [],
      watches: WorldWatchRecord[] = [];
    const entityByTerminal = new Map(
      entities.flatMap((entity) =>
        entity.terminals.map((terminal) => [terminal, entity] as const),
      ),
    );
    for (const row of active.values()) {
      const terminal = row.binding.evidence.terminals[0]!;
      const identity = {
        connection_id: connectionId,
        connection_generation: generation,
        terminal_id: terminal,
      };
      if (row.kind === "desk") {
        deskCaptures.set(watchKey(identity), row.id);
        desk.push({
          ...identity,
          agent_session_fingerprint:
            entityByTerminal.get(terminal)?.session ?? null,
          ...row.body,
        } as StoredDeskRecord);
      }
      if (row.kind === "watchlist")
        watches.push({ ...identity, label: row.body.label!, watch_id: row.id });
    }
    draft.desk.replaceConnection(connectionId, desk);
    draft.watchlist.replaceConnection(connectionId, watches);
    if (!ambiguous)
      observeDeskPanes(draft.desk, connectionId, generation, panes, at, agents);
    draft.desk.expire(at);
    const reviewsBeforeAction = new Map(
      draft.desk
        .storedRecords()
        .filter((record) => record.connection_id === connectionId)
        .map((record) => [record.terminal_id, record.reviewed_stop]),
    );
    action?.(draft);
    const candidates = new Map<
      string,
      { kind: MarkKind; terminal: string; body: MarkBody }
    >();
    const add = (kind: MarkKind, terminal: string, body: MarkBody) =>
      candidates.set(key(kind, terminal), { kind, terminal, body });
    for (const record of draft.desk.storedRecords())
      if (record.connection_id === connectionId) {
        const {
          reviewed_stop,
          stopped_at,
          opened_at,
          observed_stop_id,
          stateChangeSeq,
        } = record;
        add("desk", record.terminal_id, {
          reviewed_stop,
          stopped_at,
          opened_at,
          observed_stop_id,
          ...(stateChangeSeq !== undefined ? { stateChangeSeq } : {}),
        });
      }
    for (const record of draft.watchlist.list().records)
      if (record.connection_id === connectionId)
        add("watchlist", record.terminal_id, { label: record.label });
    // Only relevant entities cross the bounded writer queue. Global ambiguity was
    // checked above, before reducing this complete observation to a target proof.
    const ensureCurrent = () => {
      if (!isCurrent()) throw new Error("terminal mark runtime retired");
    };
    const currentRows = new Map<string, SavedTerminalMark>();
    for (const row of savedRows)
      if (
        row.kind === "desk" &&
        row.binding.state !== "ended" &&
        row.binding.evidence.session &&
        this.recoveringSources.has(row.binding.instance) &&
        (row.binding.instance !== connectionId || ambiguous)
      )
        currentRows.set(row.id, row);
    for (const [capture] of deskCaptures) {
      const [connection, , terminal] = JSON.parse(capture);
      if (connection === connectionId && !candidates.has(key("desk", terminal)))
        deskCaptures.delete(capture);
    }
    for (const id of deskCaptures.values()) {
      const row = savedById.get(id);
      if (row) currentRows.set(id, row);
    }
    let reserveBytes = 0;
    const writeDeltas = new Map<string, number>();
    for (const [k, candidate] of candidates) {
      if (candidate.kind !== "desk") continue;
      const prior = active.get(k),
        entity = entityByTerminal.get(candidate.terminal);
      if (!entity || ambiguous) continue;
      if (
        prior &&
        !legacy.resolvable.has(candidate.terminal) &&
        JSON.stringify(prior.body) === JSON.stringify(candidate.body) &&
        prior.binding.native_id === savedById.get(prior.id)?.binding.native_id
      )
        continue;
      const estimate = estimateDeskWrite(
        prior,
        legacyReviewBudgetBody(
          candidate.body,
          legacy.proofs.get(candidate.terminal),
          legacy.resolvable.has(candidate.terminal),
        ),
        entity,
        connectionId,
        at,
      );
      currentRows.set(estimate.row.id, estimate.row);
      reserveBytes += estimate.reserve;
      writeDeltas.set(k, estimate.delta);
    }
    for (const row of deskHistoryEvictions(
      savedRows,
      [...currentRows.values()],
      reserveBytes,
    )) {
      ensureCurrent();
      await this.options.storage.remove(row.id, row.revision);
      savedById.delete(row.id);
    }
    for (const row of [
      ...ended,
      ...[...active].filter(([k]) => !candidates.has(k)).map(([, row]) => row),
    ]) {
      if (!savedById.has(row.id)) continue;
      ensureCurrent();
      if (row.kind === "desk")
        await this.options.storage.end(row.id, row.revision);
      else {
        await this.options.storage.remove(row.id, row.revision);
        savedById.delete(row.id);
      }
    }
    // Shrinking writes precede growing writes, so intermediate states cannot
    // exceed the fully validated canonical resulting-plan budget.
    const orderedCandidates = [...candidates].sort(
      ([a], [b]) => (writeDeltas.get(a) ?? 0) - (writeDeltas.get(b) ?? 0),
    );
    for (const [k, candidate] of orderedCandidates) {
      const prior = active.get(k),
        entity = entityByTerminal.get(candidate.terminal);
      if (!entity || ambiguous) continue;
      if (
        prior &&
        !legacy.resolvable.has(candidate.terminal) &&
        JSON.stringify(prior.body) === JSON.stringify(candidate.body) &&
        prior.binding.native_id === savedById.get(prior.id)?.binding.native_id
      )
        continue;
      const conflict =
        !prior &&
        [...savedById.values()].find(
          (row) =>
            row.kind === candidate.kind &&
            row.binding.instance === connectionId &&
            row.binding.evidence.terminals[0] === candidate.terminal,
        );
      if (conflict && candidate.kind !== "desk") {
        if (!action) continue;
        ensureCurrent();
        await this.options.storage.remove(conflict.id, conflict.revision);
        savedById.delete(conflict.id);
      }
      ensureCurrent();
      const committed = await this.options.storage.put({
        ...(prior ? { id: prior.id, revision: prior.revision } : {}),
        kind: candidate.kind,
        body: candidate.body,
        ...(candidate.kind === "desk" && legacy.proofs.has(candidate.terminal)
          ? {
              legacy_review: {
                ...legacy.proofs.get(candidate.terminal)!,
                review_changed:
                  (reviewsBeforeAction.get(candidate.terminal) ?? null) !==
                  candidate.body.reviewed_stop,
              },
            }
          : {}),
        target: {
          adapter: "herdr",
          instance: connectionId,
          kind: "pane",
          native_id: entity.native_id,
          evidence: prior?.binding.evidence ?? {
            terminals: [candidate.terminal],
            ...(candidate.kind !== "watchlist" && entity.session
              ? { session: entity.session }
              : {}),
          },
        },
        event: { type: "listing", fence, complete: true, entities: [entity] },
        current: fence,
      });
      savedById.set(committed.id, committed);
      if (committed.kind === "desk")
        deskCaptures.set(
          watchKey({
            connection_id: connectionId,
            connection_generation: generation,
            terminal_id: candidate.terminal,
          }),
          committed.id,
        );
      if (committed.kind === "watchlist")
        this.rememberWatch({
          connection_id: connectionId,
          connection_generation: generation,
          terminal_id: candidate.terminal,
          label: committed.body.label!,
          watch_id: committed.id,
        });
    }
    ensureCurrent();
    const committedRows = this.options.storage.list();
    const committedById = new Map(committedRows.map((row) => [row.id, row]));
    const committed = new Map(
      committedRows.map((row) => [
        JSON.stringify([
          row.binding.instance,
          row.kind,
          row.binding.evidence.terminals[0],
        ]),
        row,
      ]),
    );
    const align = (view: MarkRegistries, connection: string) => {
      const deskRow = (record: StoredDeskRecord) => {
        const id = deskCaptures.get(watchKey(record));
        return id ? committedById.get(id) : undefined;
      };
      const retained = (kind: MarkKind, terminal: string) =>
        committed.get(JSON.stringify([connection, kind, terminal]));
      view.desk.replaceConnection(
        connection,
        view.desk
          .storedRecords()
          .filter(
            (record) => record.connection_id === connection && deskRow(record),
          )
          .map((record) => ({
            ...record,
            ...deskRow(record)!.body,
          })),
      );
      view.watchlist.replaceConnection(
        connection,
        view.watchlist
          .list()
          .records.filter(
            (record) =>
              record.connection_id === connection &&
              retained("watchlist", record.terminal_id),
          )
          .map((record) => ({
            ...record,
            watch_id: retained("watchlist", record.terminal_id)!.id,
          })),
      );
    };
    // Normalize committed rows before merging, so one publication advances from
    // the latest live revision and never installs another connection's old state.
    align(draft, connectionId);
    const published = {
      desk: live.desk.fork(),
      watchlist: live.watchlist.fork(),
    };
    published.desk.adoptConnection(connectionId, draft.desk);
    published.watchlist.adoptConnection(connectionId, draft.watchlist);
    const connections = new Set(
      [
        ...published.desk.list().records,
        ...published.watchlist.list().records,
      ].map((record) => record.connection_id),
    );
    for (const connection of connections)
      if (connection !== connectionId) align(published, connection);
    const before = revisions(live);
    live.desk.adopt(published.desk);
    live.watchlist.adopt(published.watchlist);
    if (!ambiguous) this.recoveringSources.delete(connectionId);
    for (const [capture, id] of this.deskCaptures)
      if (JSON.parse(capture)[0] === connectionId || !committedById.has(id))
        this.deskCaptures.delete(capture);
    for (const [capture, id] of deskCaptures)
      if (JSON.parse(capture)[0] === connectionId && committedById.has(id))
        this.deskCaptures.set(capture, id);
    this.deskRefusals.delete(connectionId);
    this.publish(before, connectionId, generation);
    this.armArchiveExpiry();
  }
}
