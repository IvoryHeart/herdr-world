import type {
  UsageEntity,
  UsageSource,
  UsageState,
  WorldUsageSnapshot,
} from "../../../shared/usage";
import type { ConnectionStatus } from "../connections/types";
import type { WorldSnapshotResult } from "../world/snapshot";
import type { OfficeObservabilitySnapshot } from "../world/observability";
import type { WorldIds } from "../storage/world-ids";
import type { RuntimeUsage } from "./host";
import {
  estimateUsage,
  parseUsagePrices,
  tokenTotal,
  usageRollups,
  usageTotal,
} from "./totals";
import { usageDigest } from "./host";
import type { Scheduler } from "../service/ports";
import { usageScope } from "./lifetime";

type UsageRuntime = {
  usage(
    agents: Record<string, unknown>[],
    now: number,
    isCurrent: () => boolean,
    signal: AbortSignal,
  ): Promise<RuntimeUsage>;
};
type Lease = {
  generation: number;
  runtime: UsageRuntime;
  isCurrent(): boolean;
};
type Cached = {
  generation: number;
  checked: number;
  success: Map<string, number>;
  topology: string;
  value: RuntimeUsage;
  ids: Map<string, string>;
  stale: Set<string>;
};
type Options = {
  incarnation: string;
  ids: WorldIds;
  connections: {
    list(): ConnectionStatus[];
    readyRuntimeLease(id: string): Lease | null;
  };
  topology(): Promise<WorldSnapshotResult>;
  prices(): Promise<unknown>;
  telemetry(): Promise<OfficeObservabilitySnapshot>;
  now(): number;
  scheduler: Scheduler;
  waitMs?: number;
  collectionMs?: number;
};
const rowKey = (r: RuntimeUsage["rows"][number]) =>
  JSON.stringify([r.session_key, r.day, r.model]);
const topologyKey = (agents: Record<string, unknown>[]) =>
  usageDigest(
    JSON.stringify(
      agents.map((a) => [
        a.agent,
        a.agent_session,
        a.terminal_id,
        a.terminal_title,
        a.pane_id,
        a.tab_id,
        a.workspace_id,
      ]),
    ),
  );
const unavailable = (): RuntimeUsage => ({
  rows: [],
  bindings: [],
  unsupported: [],
  truncated: false,
  sources: ["claude", "codex", "pi", "gemini"].map((harness) => ({
    harness,
    state: "unavailable",
  })),
});

export class WorldUsageService {
  #cache = new Map<string, Cached>();
  #pending = new Map<
    string,
    { generation: number; abort(): void; task: Promise<void> }
  >();
  #draining = new Set<Promise<void>>();
  #closed = false;
  constructor(private options: Options) {}

  async close() {
    this.#closed = true;
    for (const pending of this.#pending.values()) pending.abort();
    await Promise.allSettled(this.#draining);
    this.#cache.clear();
  }

  connectionStatus(
    status: Pick<ConnectionStatus, "id" | "generation" | "state">,
  ) {
    const pending = this.#pending.get(status.id);
    if (
      pending &&
      (pending.generation !== status.generation || status.state !== "ready")
    )
      pending.abort();
  }

  async #host(
    id: string,
    lease: Lease,
    agents: Record<string, unknown>[],
    now: number,
  ) {
    if (this.#closed) return;
    let old = this.#cache.get(id);
    if (old && old.generation !== lease.generation) {
      this.#cache.delete(id);
      old = undefined;
    }
    if (
      old &&
      now - old.checked < 30_000 &&
      Math.floor(now / 86_400_000) === Math.floor(old.checked / 86_400_000)
    )
      return;
    const existing = this.#pending.get(id);
    if (existing?.generation === lease.generation) {
      await existing.task;
      return;
    }
    existing?.abort();
    const owner = usageScope(undefined, this.options.collectionMs ?? 20_000);
    const task = (async () => {
      let value: RuntimeUsage;
      try {
        value = await lease.runtime.usage(
          agents,
          now,
          () => !this.#closed && lease.isCurrent(),
          owner.signal,
        );
      } catch {
        value = unavailable();
      }
      if (this.#closed || !lease.isCurrent()) return;
      const failed = owner.signal.aborted;
      if (failed) value = unavailable();
      const success = new Map(old?.success);
      for (const source of value.sources)
        if (
          (source.state === "available" || source.state === "partial") &&
          value.rows.some((r) => r.harness === source.harness)
        )
          success.set(source.harness, now);
      const stale = new Set<string>();
      const keys = new Set(value.rows.map(rowKey));
      for (const row of old?.value.rows ?? []) {
        if (
          !keys.has(rowKey(row)) &&
          Date.parse(row.day) >=
            Math.floor(now / 86_400_000) * 86_400_000 - 6 * 86_400_000
        ) {
          value.rows.push(row);
          stale.add(rowKey(row));
        }
      }
      // Retention and admission limits bound the service cache as well as replies.
      value.rows = value.rows.slice(0, 1024);
      const ids = new Map<string, string>();
      for (const row of value.rows) {
        if (
          this.#closed ||
          (!failed && owner.signal.aborted) ||
          !lease.isCurrent()
        )
          return;
        const key = rowKey(row);
        ids.set(
          key,
          old?.ids.get(key) ?? (await this.options.ids.issue("usage")),
        );
      }
      if (
        this.#closed ||
        (!failed && owner.signal.aborted) ||
        !lease.isCurrent()
      )
        return;
      this.#cache.set(id, {
        generation: lease.generation,
        checked: now,
        success,
        topology: topologyKey(agents),
        value,
        ids,
        stale,
      });
    })();
    this.#pending.set(id, {
      generation: lease.generation,
      task,
      abort: owner.abort,
    });
    this.#draining.add(task);
    try {
      await task;
    } finally {
      if (this.#pending.get(id)?.task === task) this.#pending.delete(id);
      this.#draining.delete(task);
      owner.dispose();
    }
  }

  async get(params: Record<string, unknown> = {}): Promise<WorldUsageSnapshot> {
    if (this.#closed) throw new Error("World usage is closed");
    if (
      params.window !== undefined &&
      params.window !== "today" &&
      params.window !== "7d"
    )
      throw new Error("Usage window must be today or 7d");
    const now = this.options.now(),
      kind = params.window === "7d" ? "7d" : "today";
    const from =
      Math.floor(now / 86_400_000) * 86_400_000 -
      (kind === "7d" ? 6 : 0) * 86_400_000;
    const statuses = this.options.connections.list();
    for (const status of statuses) this.connectionStatus(status);
    const keep = new Set(statuses.map((s) => s.id));
    for (const [id, pending] of this.#pending)
      if (!keep.has(id)) pending.abort();
    for (const id of this.#cache.keys())
      if (!keep.has(id)) this.#cache.delete(id);
    const topology = await this.options.topology();
    const selected = statuses.slice(0, 16);
    const agentsFor = (id: string, generation: number) => {
      const host = topology.connections.find(
        (c) =>
          c.connection_id === id &&
          c.generation === generation &&
          c.snapshot_generation === generation &&
          !c.stale &&
          c.actionable,
      );
      return host?.snapshot?.agents ?? [];
    };
    // At most four host collectors run at once, on demand, never by a timer.
    const refresh = (async () => {
      for (let i = 0; i < selected.length; i += 4)
        await Promise.all(
          selected.slice(i, i + 4).map(async (status) => {
            const lease = this.options.connections.readyRuntimeLease(status.id);
            if (lease?.isCurrent())
              await this.#host(
                status.id,
                lease,
                agentsFor(status.id, lease.generation),
                now,
              );
          }),
        );
    })();
    let timer: ReturnType<Scheduler["schedule"]> | undefined;
    try {
      await Promise.race([
        refresh,
        new Promise<void>((resolve) => {
          timer = this.options.scheduler.schedule(
            resolve,
            this.options.waitMs ?? 2000,
          );
        }),
      ]);
    } finally {
      timer?.cancel();
    }
    // Background failures must not become unhandled promises or raw-error logs.
    void refresh.catch(() => {});
    const table = parseUsagePrices(await this.options.prices());
    const telemetry = await this.options.telemetry();
    const entities: UsageEntity[] = [],
      sources: UsageSource[] = [];
    let truncated = statuses.length > 16;
    for (const status of selected) {
      const cached = this.#cache.get(status.id);
      const lease = this.options.connections.readyRuntimeLease(status.id);
      const fresh =
        !!cached &&
        lease?.generation === cached.generation &&
        lease.isCurrent() &&
        now - cached.checked < 60_000;
      const value = cached?.value ?? unavailable();
      truncated ||= value.truncated;
      for (const source of value.sources)
        sources.push({
          connection_id: status.id,
          connection_generation: cached?.generation ?? status.generation,
          harness: source.harness,
          state: !fresh && cached ? "stale" : source.state,
          checked_at: cached?.checked ?? now,
          last_success_at: cached?.success.get(source.harness) ?? null,
          refreshing: this.#pending.has(status.id),
        });
      for (const harness of value.unsupported.slice(0, 16))
        sources.push({
          connection_id: status.id,
          connection_generation: status.generation,
          harness,
          state: "unsupported",
          checked_at: now,
          last_success_at: null,
          refreshing: false,
        });
      const bindings =
        fresh &&
        cached?.topology ===
          topologyKey(agentsFor(status.id, cached.generation))
          ? value.bindings
          : [];
      for (const row of value.rows) {
        if (Date.parse(row.day) < from || Date.parse(row.day) >= now) continue;
        if (entities.length >= 128) {
          truncated = true;
          break;
        }
        const matches = bindings.filter(
          (b) =>
            b.harness === row.harness &&
            (b.session_key === row.session_key ||
              (b.file_key !== null && row.file_keys.includes(b.file_key))),
        );
        const target = matches.length === 1 ? matches[0] : undefined;
        const state: UsageState =
          !fresh || cached?.stale.has(rowKey(row))
            ? "stale"
            : row.partial ||
                value.sources.some(
                  (s) => s.harness === row.harness && s.state === "partial",
                )
              ? "partial"
              : "available";
        entities.push({
          id: cached!.ids.get(rowKey(row))!,
          kind: "usage",
          connector: "harness-log",
          connection_id: status.id,
          connection_generation: cached!.generation,
          pane_id: state === "stale" ? null : (target?.pane_id ?? null),
          tab_id: state === "stale" ? null : (target?.tab_id ?? null),
          workspace_id:
            state === "stale" ? null : (target?.workspace_id ?? null),
          harness: row.harness,
          model: row.model,
          day: row.day,
          tokens: { ...row.tokens },
          total_tokens: tokenTotal(row.tokens),
          responses: row.responses,
          first_at: row.first_at,
          last_at: row.last_at,
          observation_span_ms: row.last_at - row.first_at,
          estimated_cost_usd: estimateUsage(row.tokens, row.model, table),
          price_table_version: table?.version ?? null,
          state,
        });
      }
    }
    const response: WorldUsageSnapshot = {
      version: 1,
      incarnation: this.options.incarnation,
      observed_at: now,
      window: { kind, from, until: now },
      retention_days: 7,
      truncated,
      entities,
      sources,
      total: usageTotal(entities),
      unattributed: usageTotal(entities.filter((e) => !e.pane_id)),
      rollups: usageRollups(entities),
      telemetry: {
        role: "comparison",
        included_in_totals: false,
        window_seconds: telemetry.windowSeconds,
        state: telemetry.health,
        observed_at: telemetry.observedAt,
        total_tokens: telemetry.totalUsage,
      },
    };
    // Leave space for the RPC envelope and future shared projection fields.
    while (
      Buffer.byteLength(JSON.stringify(response)) > 768 * 1024 &&
      response.entities.length
    ) {
      response.truncated = true;
      response.entities.pop();
      response.total = usageTotal(response.entities);
      response.unattributed = usageTotal(
        response.entities.filter((e) => !e.pane_id),
      );
      response.rollups = usageRollups(response.entities);
    }
    return response;
  }
}
