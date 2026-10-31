import type {
  TerminalMarksPort,
  SavedTerminalMark,
  MarkKind,
  MarkBody,
} from "../storage/terminal-marks";
import type {
  BindingEntity,
  BindingFence,
  BindingEvent,
} from "./binding-types";
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
import { WorldWatchlistRegistry, type WorldWatchRecord } from "./watchlist";
import {
  WorldCompletionSeenRegistry,
  type CompletionSeenIdentity,
} from "./completion-seen";

type Identity = CompletionSeenIdentity & {
  agent_session_fingerprint?: string | null;
};
export type MarkRegistries = {
  desk: WorldDeskRegistry;
  watchlist: WorldWatchlistRegistry;
  seen: WorldCompletionSeenRegistry;
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
  r.seen.list().revision,
];

function terminalEntities(
  panes: readonly Record<string, unknown>[],
): BindingEntity[] {
  return panes.map((pane) => ({
    native_id: typeof pane.pane_id === "string" ? pane.pane_id : "",
    terminals: typeof pane.terminal_id === "string" ? [pane.terminal_id] : [],
    ...(deskSessionFingerprint(pane.agent_session)
      ? { session: deskSessionFingerprint(pane.agent_session)! }
      : {}),
  }));
}

/** Serial admission, committed publication, and unresolved restart captures. */
export class PersistentTerminalMarks {
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private closed = false;
  private runtimeEpoch = new Map<string, number>();
  private admissions = new Set<{
    connectionId: string;
    generation: number;
    terminal: string;
    session?: string;
    valid: boolean;
  }>();
  constructor(private readonly options: Options) {}
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
    await this.tail;
  }
  expire() {
    return this.enqueue(async () => {
      const at = this.options.now();
      if (
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
    });
  }
  /** Runtime replacement hides the projection; saved identity waits for a fresh list. */
  retire(connectionId: string, generation: number, ready = true) {
    if (!ready)
      this.runtimeEpoch.set(
        connectionId,
        (this.runtimeEpoch.get(connectionId) ?? 0) + 1,
      );
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
    r.seen.retireConnectionGeneration(connectionId, ready ? generation : -1);
    this.publish(before, connectionId, generation);
  }
  observe(
    connectionId: string,
    generation: number,
    panes: readonly Record<string, unknown>[],
    at: number,
    agents: readonly Record<string, unknown>[] = [],
  ) {
    const epoch = this.runtimeEpoch.get(connectionId) ?? 0;
    const guards = [...this.admissions].filter(
      (guard) =>
        guard.connectionId === connectionId && guard.generation === generation,
    );
    if (guards.length) {
      const lease = this.options.lease(connectionId);
      if (lease?.generation === generation && lease.isCurrent()) {
        const entities = terminalEntities(panes),
          ambiguous =
            entities.some((entity) => !entity.native_id) ||
            bindingObservationAmbiguous(entities);
        for (const guard of guards) {
          const entity = entities.find((entity) =>
            entity.terminals.includes(guard.terminal),
          );
          guard.valid &&=
            !ambiguous &&
            Boolean(entity) &&
            (!guard.session || entity?.session === guard.session);
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
    }).catch((error) => {
      const lease = this.options.lease(connectionId);
      if (
        lease?.generation === generation &&
        lease.isCurrent() &&
        epoch === (this.runtimeEpoch.get(connectionId) ?? 0)
      )
        this.options.failed(error);
    });
  }
  unpin(identity: Identity) {
    return this.enqueue(async () => {
      const live = this.options.registries;
      if (!live.watchlist.fork().unpin(identity).changed) return;
      const row = this.options.storage
        .list()
        .find(
          (row) =>
            row.kind === "watchlist" &&
            row.binding.instance === identity.connection_id &&
            row.binding.evidence.terminals[0] === identity.terminal_id,
        );
      if (row) await this.options.storage.remove(row.id, row.revision);
      const before = revisions(live),
        draft = live.watchlist.fork();
      draft.unpin(identity);
      live.watchlist.adopt(draft);
      this.publish(
        before,
        identity.connection_id,
        identity.connection_generation,
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
  ) {
    return this.enqueue(async () => {
      const lease = this.options.lease(identity.connection_id);
      if (
        !lease ||
        lease.generation !== identity.connection_generation ||
        !lease.isCurrent()
      )
        throw new Error("terminal mark target is unavailable");
      const guard = {
        connectionId: identity.connection_id,
        generation: identity.connection_generation,
        terminal: identity.terminal_id,
        ...(typeof identity.agent_session_fingerprint === "string"
          ? { session: identity.agent_session_fingerprint }
          : {}),
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
    const after = revisions(this.options.registries);
    (["desk", "watchlist", "completion-seen"] as const).forEach((kind, i) => {
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
    const fence: BindingFence = {
      adapter: "herdr",
      instance: connectionId,
      generation,
      service_incarnation: this.options.incarnation,
    };
    const entities = terminalEntities(panes);
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
    for (const row of savedRows) {
      if (row.binding.instance !== connectionId) continue;
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
      seen: live.seen.fork(),
    };
    const desk: StoredDeskRecord[] = [],
      watches: WorldWatchRecord[] = [],
      checks: CompletionSeenIdentity[] = [];
    const entityByTerminal = new Map(
      entities.flatMap((entity) =>
        entity.terminals.map((terminal) => [terminal, entity] as const),
      ),
    );
    const admitted = admittedAgentPanes(panes, agents);
    const statusByTerminal = new Map(
      admitted.map((agent) => [agent.terminalId, agent]),
    );
    for (const row of active.values()) {
      const terminal = row.binding.evidence.terminals[0]!;
      const identity = {
        connection_id: connectionId,
        connection_generation: generation,
        terminal_id: terminal,
      };
      if (row.kind === "desk")
        desk.push({
          ...identity,
          agent_session_fingerprint:
            entityByTerminal.get(terminal)?.session ?? null,
          ...row.body,
        } as StoredDeskRecord);
      if (row.kind === "watchlist")
        watches.push({ ...identity, label: row.body.label! });
      if (row.kind === "completion-seen") {
        const sequence = statusByTerminal.get(terminal)?.sequence;
        if (
          row.body.stateChangeSeq !== undefined &&
          Number.isSafeInteger(sequence) &&
          Number(sequence) > row.body.stateChangeSeq
        )
          continue;
        checks.push(identity);
      }
    }
    draft.desk.replaceConnection(connectionId, desk);
    draft.watchlist.replaceConnection(connectionId, watches);
    draft.seen.replaceConnection(connectionId, checks);
    if (!ambiguous) {
      observeDeskPanes(draft.desk, connectionId, generation, panes, at, agents);
      for (const agent of admitted) {
        const seenSequence = active.get(
          key("completion-seen", agent.terminalId),
        )?.body.stateChangeSeq;
        if (
          seenSequence !== undefined &&
          Number.isSafeInteger(agent.sequence) &&
          Number(agent.sequence) < seenSequence
        )
          continue;
        draft.seen.observe(
          {
            connection_id: connectionId,
            connection_generation: generation,
            terminal_id: agent.terminalId,
          },
          agent.status === "working" || agent.status === "blocked",
        );
      }
    }
    draft.desk.expire(at);
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
    for (const record of draft.seen.list().records)
      if (record.connection_id === connectionId) {
        const prior = active.get(key("completion-seen", record.terminal_id));
        const sequence =
          prior?.body.stateChangeSeq ??
          statusByTerminal.get(record.terminal_id)?.sequence;
        add(
          "completion-seen",
          record.terminal_id,
          Number.isSafeInteger(sequence)
            ? { stateChangeSeq: Number(sequence) }
            : {},
        );
      }
    // Only relevant entities cross the bounded writer queue. Global ambiguity was
    // checked above, before reducing this complete observation to a target proof.
    const ensureCurrent = () => {
      if (!isCurrent()) throw new Error("terminal mark runtime retired");
    };
    for (const row of [
      ...ended,
      ...[...active].filter(([k]) => !candidates.has(k)).map(([, row]) => row),
    ]) {
      ensureCurrent();
      await this.options.storage.remove(row.id, row.revision);
      savedById.delete(row.id);
    }
    for (const [k, candidate] of candidates) {
      const prior = active.get(k),
        entity = entityByTerminal.get(candidate.terminal);
      if (!entity || ambiguous) continue;
      if (
        prior &&
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
      if (conflict) {
        if (!action) continue;
        ensureCurrent();
        await this.options.storage.remove(conflict.id, conflict.revision);
        savedById.delete(conflict.id);
      }
      const rows = [...savedById.values()],
        limit = candidate.kind === "desk" ? 500 : 4096;
      if (!prior && candidate.kind !== "watchlist") {
        const sameKind = rows.filter((row) => row.kind === candidate.kind);
        if (sameKind.length >= limit) {
          ensureCurrent();
          await this.options.storage.remove(
            sameKind[0]!.id,
            sameKind[0]!.revision,
          );
          savedById.delete(sameKind[0]!.id);
        }
      }
      ensureCurrent();
      const committed = await this.options.storage.put({
        ...(prior ? { id: prior.id, revision: prior.revision } : {}),
        kind: candidate.kind,
        body: candidate.body,
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
    }
    ensureCurrent();
    const committed = new Map(
      this.options.storage
        .list()
        .map((row) => [
          JSON.stringify([
            row.binding.instance,
            row.kind,
            row.binding.evidence.terminals[0],
          ]),
          row,
        ]),
    );
    const connections = new Set(
      [
        ...draft.desk.list().records,
        ...draft.watchlist.list().records,
        ...draft.seen.list().records,
      ].map((record) => record.connection_id),
    );
    for (const connection of connections) {
      const retained = (kind: MarkKind, terminal: string) =>
        committed.get(JSON.stringify([connection, kind, terminal]));
      draft.desk.replaceConnection(
        connection,
        draft.desk
          .storedRecords()
          .filter(
            (record) =>
              record.connection_id === connection &&
              retained("desk", record.terminal_id),
          )
          .map((record) => ({
            ...record,
            ...retained("desk", record.terminal_id)!.body,
          })),
      );
      draft.watchlist.replaceConnection(
        connection,
        draft.watchlist
          .list()
          .records.filter(
            (record) =>
              record.connection_id === connection &&
              retained("watchlist", record.terminal_id),
          ),
      );
      draft.seen.replaceConnection(
        connection,
        draft.seen
          .list()
          .records.filter(
            (record) =>
              record.connection_id === connection &&
              retained("completion-seen", record.terminal_id),
          ),
      );
    }
    const before = revisions(live);
    live.desk.adopt(draft.desk);
    live.watchlist.adopt(draft.watchlist);
    live.seen.adopt(draft.seen);
    this.publish(before, connectionId, generation);
  }
}
