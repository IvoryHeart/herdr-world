import {
  usageLimitExpired,
  type UsageContext,
  type UsageEntity,
  type UsageLimit,
  type UsageSource,
  type UsageState,
  type WorldUsageSnapshot,
} from "../../../shared/usage";
import type { ConnectionStatus } from "../connections/types";
import type { WorldSnapshotResult } from "../world/snapshot";
import type { OfficeObservabilitySnapshot } from "../world/observability";
import type { RuntimeUsage } from "./host";
import { estimateUsage, parseUsagePrices, tokenTotal } from "./totals";
import { usageDigest } from "./host";
import type { Scheduler } from "../service/ports";
import { usageScope } from "./lifetime";
import { codexIdsFromTitle } from "../agent/session-resolver";
import { normalizeAgentName } from "../agent/chat-harnesses";
import { boundUsageDetails, summarizeUsage } from "./summary";
import { contextWindowTokens } from "./context-window";

import type { HerdrCall } from "../agent/session-types";

type UsageRuntime = {
  herdr: { call: HerdrCall };
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
  stale: Set<string>;
  /** Harnesses whose limits were kept from an earlier read after this one failed. */
  limitsStale: Set<string>;
};
type Options = {
  incarnation: string;
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
      agents
        .map((a) =>
          JSON.stringify([
            a.agent,
            a.agent_session,
            a.terminal_id,
            normalizeAgentName(String(a.agent ?? "")) === "codex"
              ? codexIdsFromTitle(String(a.terminal_title ?? ""))
              : null,
            a.pane_id,
            a.tab_id,
            a.workspace_id,
          ]),
        )
        .sort(),
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
        if (value.bindings.length) {
          // One native post-read inventory checks all claims, including new or
          // previously unlinked agents. A failed/changed inventory is unattributed.
          try {
            const current = (await lease.runtime.herdr.call(
              "agent.list",
              {},
              8000,
              undefined,
              owner.signal,
            )) as { agents?: Record<string, unknown>[] };
            value.truncated ||=
              Array.isArray(current.agents) && current.agents.length > 128;
            if (
              !Array.isArray(current.agents) ||
              current.agents.length > 128 ||
              topologyKey(agents) !== topologyKey(current.agents)
            )
              value.bindings = [];
          } catch {
            value.bindings = [];
          }
        }
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
      // A failed or partial read cannot establish a newer observation, so it
      // keeps the newer cached limits as stale rather than older numbers.
      const limitsStale = new Set<string>();
      for (const harness of ["codex", "claude"]) {
        const cachedLimit = old?.value.limits?.find(
          (l) => l.harness === harness,
        );
        const readLimit = value.limits?.find((l) => l.harness === harness);
        if (
          cachedLimit &&
          (!readLimit || readLimit.at < cachedLimit.at) &&
          value.sources.some(
            (s) =>
              s.harness === harness &&
              (s.state === "unavailable" || s.state === "partial"),
          )
        ) {
          value.limits = [
            ...(value.limits ?? []).filter((l) => l.harness !== harness),
            cachedLimit,
          ];
          limitsStale.add(harness);
        }
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
        stale,
        limitsStale,
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
      sources: UsageSource[] = [],
      limits: UsageLimit[] = [],
      contexts: UsageContext[] = [];
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
      const generation = cached?.generation ?? status.generation;
      for (const harness of ["codex", "claude"] as const) {
        const limit = value.limits?.find((l) => l.harness === harness);
        limits.push(
          limit
            ? {
                connection_id: status.id,
                connection_generation: generation,
                harness,
                state:
                  !fresh ||
                  cached.limitsStale.has(harness) ||
                  usageLimitExpired(
                    limit.at,
                    limit.windows,
                    now,
                    limit.reached ?? null,
                  )
                    ? "stale"
                    : "available",
                source: limit.source,
                reason: null,
                observed_at: limit.at,
                windows: limit.windows.map((w) => ({ ...w })),
                reached: limit.reached ? { ...limit.reached } : null,
              }
            : {
                connection_id: status.id,
                connection_generation: generation,
                harness,
                state: "missing",
                source: null,
                reason: null,
                observed_at: null,
                windows: [],
                reached: null,
              },
        );
      }
      const bindings =
        fresh &&
        cached?.topology ===
          topologyKey(agentsFor(status.id, cached.generation))
          ? value.bindings
          : [];
      // A pane's context bar: only a fresh read with a unique current-session
      // match, the newest when a pane's session has several files.
      const panes = new Map<string, UsageContext>();
      for (const context of fresh ? (value.contexts ?? []) : []) {
        const matches = bindings.filter(
          (b) =>
            b.harness === context.harness &&
            (b.session_key === context.session_key ||
              (b.file_key !== null && context.file_keys.includes(b.file_key))),
        );
        if (matches.length !== 1) continue;
        const target = matches[0]!;
        const prior = panes.get(target.pane_id);
        if (prior && prior.observed_at >= context.at) continue;
        panes.set(target.pane_id, {
          connection_id: status.id,
          connection_generation: cached!.generation,
          workspace_id: target.workspace_id,
          tab_id: target.tab_id,
          pane_id: target.pane_id,
          harness: context.harness,
          model: context.model,
          used_tokens: context.used_tokens,
          window_tokens: contextWindowTokens(
            context.model,
            context.window_tokens,
          ),
          observed_at: context.at,
        });
      }
      for (const context of panes.values()) {
        if (contexts.length >= 256) {
          truncated = true;
          break;
        }
        contexts.push(context);
      }
      for (const row of value.rows) {
        if (Date.parse(row.day) < from || Date.parse(row.day) >= now) continue;
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
          id: `usage_${usageDigest(JSON.stringify([status.id, cached!.generation, rowKey(row)]))}`,
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
      price_table_version: table?.version ?? null,
      ...summarizeUsage(entities),
      ...(kind === "7d"
        ? {
            today: summarizeUsage(
              entities.filter(
                (e) =>
                  Date.parse(e.day) >=
                  Math.floor(now / 86_400_000) * 86_400_000,
              ),
            ),
          }
        : {}),
      limits,
      contexts,
      telemetry: {
        role: "comparison",
        included_in_totals: false,
        window_seconds: telemetry.windowSeconds,
        state: telemetry.health,
        observed_at: telemetry.observedAt,
        total_tokens: telemetry.totalUsage,
      },
    };
    boundUsageDetails(response);
    return response;
  }
}
