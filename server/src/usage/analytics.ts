import type { WorldUsageSnapshot } from "../../../shared/usage";
import {
  USAGE_ANALYTICS_GROUPS,
  type UsageAnalyticsIdentity,
  type UsageAnalyticsMetrics,
  type UsageAnalyticsQuery,
  type UsageAnalyticsRow,
  type UsageAnalyticsRun,
  type UsageMetric,
  type UsageProject,
  type WorldUsageAnalytics,
} from "../../../shared/usageAnalytics";
import type { WorldSourcesSnapshot } from "../../../shared/worldSources";
import type { WorldSnapshotResult } from "../world/snapshot";
import {
  analyticsAgentId,
  identity as activityIdentity,
  type ActivityRow,
  UsageActivity,
} from "./activity";
import { joinUsageSpans } from "../../../shared/usageSpans";
import { usageDigest } from "./host";
import { agentSessionOf } from "../agent/checkout-context";
import { agentCheckoutSessionFingerprint } from "../herdr/agent-checkout";

import { UsageQueryError } from "../features/usage/errors";
export { UsageQueryError } from "../features/usage/errors";
export function parseAnalyticsQuery(
  raw: Record<string, unknown> = {},
): UsageAnalyticsQuery {
  const allowed = [
    "window",
    "group_by",
    "connection_id",
    "connection_generation",
    "pane_id",
    "workspace_id",
    "project_id",
  ];
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).some((k) => !allowed.includes(k))
  )
    throw new UsageQueryError("Unknown usage analytics parameter");
  if (raw.window !== undefined && raw.window !== "today" && raw.window !== "7d")
    throw new UsageQueryError("Usage window must be today or 7d");
  if (
    raw.group_by !== undefined &&
    !USAGE_ANALYTICS_GROUPS.includes(raw.group_by as never)
  )
    throw new UsageQueryError("Group by agent, project, room, day or run");
  for (const key of ["connection_id", "pane_id", "workspace_id", "project_id"])
    if (
      raw[key] !== undefined &&
      (typeof raw[key] !== "string" ||
        !raw[key] ||
        (raw[key] as string).length > 512)
    )
      throw new UsageQueryError(`Invalid ${key}`);
  if (
    raw.connection_generation !== undefined &&
    (!Number.isSafeInteger(raw.connection_generation) ||
      (raw.connection_generation as number) < 0)
  )
    throw new UsageQueryError("Invalid connection generation");
  if (
    (raw.connection_id === undefined) !==
      (raw.connection_generation === undefined) ||
    ((raw.pane_id !== undefined || raw.workspace_id !== undefined) &&
      raw.connection_id === undefined)
  )
    throw new UsageQueryError(
      "Connection filters require connection_id and connection_generation",
    );
  if (
    raw.project_id !== undefined &&
    !/^project_[a-f0-9]{64}$/.test(raw.project_id as string)
  )
    throw new UsageQueryError("Invalid project ID");
  return raw as UsageAnalyticsQuery;
}
type Fact = {
  identity: UsageAnalyticsIdentity;
  day: string;
  usage?: WorldUsageSnapshot["entities"][number];
  activity?: ActivityRow;
  pr?: { key: string; event: "opened" | "merged" };
};
const metric = (value: number | null, partial = true): UsageMetric => ({
  value,
  coverage: value === null ? "unknown" : partial ? "partial" : "observed",
});
function metrics(facts: Fact[]): UsageAnalyticsMetrics {
  const usage = facts.flatMap((f) =>
    f.usage && f.usage.state !== "stale" ? [f.usage] : [],
  );
  const activity = facts.flatMap((f) => (f.activity ? [f.activity] : []));
  const sum = (key: "active_ms" | "waiting_on_you_ms" | "observed_ms") =>
    activity.reduce((s, r) => s + r[key], 0);
  const tokens = usage.length
    ? { input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 }
    : null;
  if (tokens)
    for (const row of usage)
      for (const k of Object.keys(tokens) as (keyof typeof tokens)[])
        tokens[k] += row.tokens[k];
  const prs = (event: "opened" | "merged") => {
    const records = facts.flatMap((f) =>
      f.pr?.event === event ? [f.pr.key] : [],
    );
    return metric(records.length ? new Set(records).size : null);
  };
  const priced = usage.filter((r) => r.estimated_cost_usd !== null);
  const reported = usage.filter(
    (r) => r.reported_cost_usd !== undefined && r.reported_cost_usd !== null,
  );
  return {
    active_ms: metric(activity.length ? sum("active_ms") : null),
    waiting_on_you_ms: metric(
      activity.length ? sum("waiting_on_you_ms") : null,
    ),
    observed_ms: sum("observed_ms"),
    tokens,
    total_tokens: metric(
      usage.length ? usage.reduce((s, r) => s + r.total_tokens, 0) : null,
    ),
    reported_cost_usd: metric(
      reported.length
        ? reported.reduce((s, r) => s + r.reported_cost_usd!, 0)
        : null,
    ),
    estimated_cost_usd: metric(
      priced.length
        ? priced.reduce((s, r) => s + r.estimated_cost_usd!, 0)
        : null,
    ),
    prs_opened: prs("opened"),
    prs_merged: prs("merged"),
  };
}
const targetKey = (connection: string, generation: number, pane: string) =>
  JSON.stringify([connection, generation, pane]);

export class WorldUsageAnalyticsService {
  constructor(
    private readonly options: {
      usage(params: Record<string, unknown>): Promise<WorldUsageSnapshot>;
      topology(): Promise<WorldSnapshotResult>;
      sources(): Promise<WorldSourcesSnapshot>;
      activity: UsageActivity;
      project(
        connection: string,
        generation: number,
        path: string,
      ): Promise<UsageProject | null>;
      current(connection: string, generation: number): boolean;
      now?(): number;
    },
  ) {}
  async get(raw: Record<string, unknown> = {}): Promise<WorldUsageAnalytics> {
    const query = parseAnalyticsQuery(raw);
    const [usage, topology, work] = await Promise.all([
      this.options.usage({ window: query.window ?? "today" }),
      this.options.topology(),
      this.options.sources(),
    ]);
    let now = usage.observed_at;
    const identities = new Map<string, UsageAnalyticsIdentity>();
    const sessionProof = new Map<string, string>();
    const projects = new Map<string, UsageProject>();
    const candidates: {
      connection: string;
      generation: number;
      pane: Record<string, unknown>;
    }[] = [];
    for (const host of topology.connections) {
      if (
        host.stale ||
        !host.actionable ||
        host.snapshot_generation !== host.generation ||
        !host.snapshot
      )
        continue;
      for (const agent of host.snapshot.agents) {
        const pane = host.snapshot.panes.find(
          (p) => p.pane_id === agent.pane_id,
        );
        if (pane)
          candidates.push({
            connection: host.connection_id,
            generation: host.generation,
            pane: { ...pane, ...agent },
          });
      }
    }
    // Git reads are read-only, four at a time, and never accept a browser path.
    const resolved = new Map<string, UsageProject | null>();
    const paths = [
      ...new Map(
        candidates.flatMap(({ connection, generation, pane }) => {
          const path = pane.foreground_cwd ?? pane.cwd;
          return typeof path === "string" &&
            path.length <= 4096 &&
            !path.includes("\0")
            ? [
                [
                  JSON.stringify([connection, generation, path]),
                  { connection, generation, path },
                ] as const,
              ]
            : [];
        }),
      ).entries(),
    ];
    const projectTruncated = paths.length > 32;
    for (let i = 0; i < Math.min(paths.length, 32); i += 4)
      await Promise.all(
        paths.slice(i, Math.min(i + 4, 32)).map(async ([key, p]) => {
          const value = await this.options
            .project(p.connection, p.generation, p.path)
            .catch(() => null);
          if (this.options.current(p.connection, p.generation))
            resolved.set(key, value);
        }),
      );
    // One post-read inventory fences session, room and checkout changes too.
    const latest = await this.options.topology();
    now = Math.max(now, latest.observed_at ?? now, this.options.now?.() ?? now);
    const until = now,
      from =
        Math.floor(now / 86_400_000) * 86_400_000 -
        (usage.window.kind === "7d" ? 6 : 0) * 86_400_000;
    for (const { connection, generation, pane } of candidates) {
      if (
        !this.options.current(connection, generation) ||
        typeof pane.pane_id !== "string"
      )
        continue;
      const host = latest.connections.find(
        (h) =>
          h.connection_id === connection &&
          h.generation === generation &&
          h.snapshot_generation === generation &&
          !h.stale &&
          h.actionable,
      );
      const agent = host?.snapshot?.agents.find(
        (a) => a.pane_id === pane.pane_id,
      );
      const terminal = host?.snapshot?.panes.find(
        (p) => p.pane_id === pane.pane_id,
      );
      const current = agent && terminal ? { ...terminal, ...agent } : null;
      if (
        !current ||
        analyticsAgentId(connection, generation, current) !==
          analyticsAgentId(connection, generation, pane) ||
        current.workspace_id !== pane.workspace_id ||
        current.tab_id !== pane.tab_id ||
        (current.foreground_cwd ?? current.cwd) !==
          (pane.foreground_cwd ?? pane.cwd)
      )
        continue;
      const path = pane.foreground_cwd ?? pane.cwd;
      const project = resolved.get(
        JSON.stringify([connection, generation, path]),
      );
      if (project) projects.set(project.id, project);
      const agentId = analyticsAgentId(connection, generation, pane);
      const session = agentSessionOf(pane.agent_session);
      if (session)
        sessionProof.set(
          targetKey(connection, generation, pane.pane_id),
          agentCheckoutSessionFingerprint(session),
        );
      if (project && agentId)
        this.options.activity.assignProject(agentId, project.id, now);
      identities.set(targetKey(connection, generation, pane.pane_id), {
        connection_id: connection,
        connection_generation: generation,
        agent_id: agentId,
        pane_id: pane.pane_id,
        workspace_id:
          typeof pane.workspace_id === "string" ? pane.workspace_id : null,
        project_id: project?.id ?? null,
      });
    }
    const facts: Fact[] = usage.entities
      .filter(
        (row) => Date.parse(row.day) >= from && Date.parse(row.day) < until,
      )
      .map((row) => ({
        day: row.day,
        usage: row,
        identity:
          row.pane_id && row.state !== "stale"
            ? (identities.get(
                targetKey(
                  row.connection_id,
                  row.connection_generation,
                  row.pane_id,
                ),
              ) ?? emptyIdentity(row.connection_id, row.connection_generation))
            : emptyIdentity(row.connection_id, row.connection_generation),
      }));
    for (const row of this.options.activity.read(now))
      if (Date.parse(row.day) >= from && Date.parse(row.day) < until)
        facts.push({
          day: row.day,
          identity: activityIdentity(row),
          activity: row,
        });
    // An agent and its transcript run are one run: link them while both are
    // current (the newest run in the agent's pane), and keep the link.
    const newestRun = new Map<string, { run: string; at: number }>();
    for (const fact of facts)
      if (fact.usage?.run_id && fact.identity.agent_id) {
        const prior = newestRun.get(fact.identity.agent_id);
        if (!prior || fact.usage.last_at > prior.at)
          newestRun.set(fact.identity.agent_id, {
            run: fact.usage.run_id,
            at: fact.usage.last_at,
          });
      }
    for (const [agent, { run }] of newestRun)
      this.options.activity.linkRun(agent, run);
    // A run's pull request: only a link the agent's own session validates,
    // naming exactly one pull request (docs/usage-analytics.md).
    for (const [key, identity] of identities) {
      const run = identity.agent_id
        ? this.options.activity.runOf(identity.agent_id)
        : null;
      if (!run) continue;
      const proof = sessionProof.get(key);
      const linked = new Set(
        work.links
          .filter(
            (l) =>
              proof &&
              l.sessionFingerprint === proof &&
              targetKey(l.connectionId, l.generation, l.paneId) === key,
          )
          .map((l) => l.itemKey)
          .filter((itemKey) =>
            work.items.some(
              (item) =>
                item.key === itemKey &&
                item.source === "github" &&
                item.kind === "pull_request",
            ),
          ),
      );
      if (linked.size === 1)
        this.options.activity.linkItem(run, [...linked][0]!);
    }
    // Count a PR once globally. Multiple current agents cannot prove authorship.
    const seenPr = new Set<string>();
    for (const item of work.items) {
      if (
        item.source !== "github" ||
        item.kind !== "pull_request" ||
        !item.roles.includes("author") ||
        seenPr.has(item.key)
      )
        continue;
      seenPr.add(item.key);
      const linked = new Map(
        work.links
          .filter((l) => l.itemKey === item.key)
          .flatMap((l) => {
            const key = targetKey(l.connectionId, l.generation, l.paneId);
            const value =
              l.sessionFingerprint &&
              sessionProof.get(key) === l.sessionFingerprint
                ? identities.get(key)
                : undefined;
            return value ? [[JSON.stringify(value), value] as const] : [];
          }),
      );
      const identity =
        linked.size === 1
          ? [...linked.values()][0]!
          : emptyIdentity("unattributed", 0);
      for (const [event, time] of [
        ["opened", item.createdAt],
        ["merged", item.finishedAt],
      ] as const)
        if (time !== undefined && time >= from && time < until)
          facts.push({
            day: new Date(time).toISOString().slice(0, 10),
            identity,
            pr: { key: item.key, event },
          });
    }
    const selected = facts.filter(
      ({ identity: i }) =>
        (query.connection_id === undefined ||
          (i.connection_id === query.connection_id &&
            i.connection_generation === query.connection_generation)) &&
        (query.pane_id === undefined || i.pane_id === query.pane_id) &&
        (query.workspace_id === undefined ||
          i.workspace_id === query.workspace_id) &&
        (query.project_id === undefined || i.project_id === query.project_id),
    );
    const group = query.group_by ?? "day";
    const groups = new Map<
      string,
      {
        dimension: string | null;
        identity: UsageAnalyticsIdentity | null;
        facts: Fact[];
      }
    >();
    for (const fact of selected) {
      const i = fact.identity;
      const dimension =
        group === "run"
          ? (fact.usage?.run_id ??
            (fact.activity && i.agent_id
              ? (this.options.activity.runOf(i.agent_id) ??
                `world:${i.agent_id}`)
              : null))
          : group === "day"
            ? fact.day
            : group === "agent"
              ? i.agent_id
              : group === "project"
                ? i.project_id
                : i.workspace_id
                  ? JSON.stringify([
                      i.connection_id,
                      i.connection_generation,
                      i.workspace_id,
                    ])
                  : null;
      const key = dimension ?? "unattributed";
      const bucket = groups.get(key) ?? {
        dimension,
        identity:
          group === "agent"
            ? { ...i, workspace_id: null, project_id: null }
            : group === "run" && dimension
              ? i
              : group === "room" && i.workspace_id
                ? { ...i, agent_id: null, pane_id: null, project_id: null }
                : null,
        facts: [],
      };
      bucket.facts.push(fact);
      // A run's attributed fact names its pane, even if an older day's not.
      if (
        group === "run" &&
        dimension &&
        i.pane_id &&
        !bucket.identity?.pane_id
      )
        bucket.identity = i;
      groups.set(key, bucket);
    }
    const rows: UsageAnalyticsRow[] = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, b]) => ({
        key,
        dimension: b.dimension,
        identity: b.identity,
        ...metrics(b.facts),
        ...(group === "run" && b.dimension
          ? {
              run: runDetail(
                b.facts,
                b.identity,
                usage,
                work,
                this.options.activity.itemOf(b.dimension),
              ),
            }
          : {}),
      }));
    // Empty UTC buckets are unknown, never fabricated measured zeros.
    if (group === "day")
      for (let time = from; time < until; time += 86_400_000) {
        const day = new Date(time).toISOString().slice(0, 10);
        if (!groups.has(day))
          rows.push({
            key: day,
            dimension: day,
            identity: null,
            ...metrics([]),
          });
      }
    // Heaviest runs first, so clipping keeps the ones worth looking at.
    if (group === "run")
      rows.sort(
        (a, b) =>
          (b.total_tokens.value ?? -1) - (a.total_tokens.value ?? -1) ||
          a.key.localeCompare(b.key),
      );
    else rows.sort((a, b) => a.key.localeCompare(b.key));
    const github = work.sources.find((s) => s.id === "github");
    const response: WorldUsageAnalytics = {
      version: 1,
      incarnation: usage.incarnation,
      observed_at: now,
      window: { kind: usage.window.kind, from, until },
      retention_days: 7,
      group_by: group,
      total: metrics(selected),
      rows: rows.slice(0, 512),
      projects: [...projects.values()].filter(
        (p) =>
          (query.project_id === undefined || p.id === query.project_id) &&
          (query.connection_id === undefined ||
            (p.connection_id === query.connection_id &&
              p.connection_generation === query.connection_generation)),
      ),
      sources: usage.sources.filter(
        (s) =>
          query.connection_id === undefined ||
          (s.connection_id === query.connection_id &&
            s.connection_generation === query.connection_generation),
      ),
      limits: usage.limits.filter(
        (l) =>
          query.connection_id === undefined ||
          (l.connection_id === query.connection_id &&
            l.connection_generation === query.connection_generation),
      ),
      coverage: {
        truncated:
          usage.truncated ||
          this.options.activity.truncated ||
          rows.length > 512,
        activity: selected.some((f) => f.activity) ? "partial" : "unknown",
        pull_requests: work.sources.some(
          (s) => s.id === "github" && s.state === "connected",
        )
          ? "partial"
          : "unknown",
        pull_request_source: {
          state: github?.state ?? "unavailable",
          checked_at: github?.checkedAt ?? null,
          last_success_at: github?.lastSuccessAt ?? null,
          refreshing: work.refreshing,
        },
        project_lookups_truncated: projectTruncated,
        history: this.options.activity.history,
        time_basis: "observed-runtime-status",
      },
    };
    while (
      Buffer.byteLength(JSON.stringify(response)) > 768 * 1024 &&
      response.rows.length
    ) {
      response.rows.length = Math.floor(response.rows.length / 2);
      response.coverage.truncated = true;
    }
    this.options.activity.save(now);
    response.coverage.history = this.options.activity.history;
    response.coverage.truncated ||= this.options.activity.truncated;
    return response;
  }
}
/**
 * Responses at most this far apart are one span of work. It matches the host
 * reader's own joining (projection.ts), and joins a run's days.
 */
const RUN_SPAN_GAP_MS = 10 * 60_000;
/**
 * A run's detail from its own usage rows, World's measured activity, current
 * context and work links. A run with no usage rows is World's measurement
 * alone: calls and prompts are unknown.
 */
function runDetail(
  facts: Fact[],
  identity: UsageAnalyticsIdentity | null,
  usage: WorldUsageSnapshot,
  work: WorldSourcesSnapshot,
  linkedItem: string | null,
): UsageAnalyticsRun {
  const rows = facts.flatMap((f) => (f.usage ? [f.usage] : []));
  const activity = facts.flatMap((f) => (f.activity ? [f.activity] : []));
  const models = new Map<string, number>();
  let prompt: number | null = null;
  for (const row of rows) {
    models.set(row.model, (models.get(row.model) ?? 0) + row.total_tokens);
    if (row.max_prompt_tokens !== undefined)
      prompt = Math.max(prompt ?? 0, row.max_prompt_tokens);
  }
  const spans = joinUsageSpans([
    ...joinUsageSpans(
      rows.flatMap((r) => r.spans ?? []),
      RUN_SPAN_GAP_MS,
      Infinity,
    ),
    ...activity.flatMap((a) => a.spans ?? []),
  ]);
  const newest = rows.length
    ? rows.reduce((a, b) => (b.last_at > a.last_at ? b : a))
    : null;
  const harness =
    newest?.harness ?? activity.find((a) => a.harness)?.harness ?? "unknown";
  const branch = rows.find((r) => r.branch)?.branch ?? null;
  const role = rows.find((r) => r.role)?.role ?? null;
  const pullRequests = work.items.filter(
    (item) => item.source === "github" && item.kind === "pull_request",
  );
  // Only a session-validated link names the pull request. A branch alone
  // never does: it carries no repository, and the same branch name in another
  // repository is not this run's work. A catalogue pull request with the
  // run's branch but no link leaves the pull request unknown (ambiguous).
  const linked = linkedItem
    ? (pullRequests.find((item) => item.key === linkedItem) ?? {
        key: linkedItem,
        number: Number(/#(\d+)$/.exec(linkedItem)?.[1]) || undefined,
      })
    : undefined;
  const pr = linked;
  const attribution = linked
    ? "link"
    : branch && pullRequests.some((item) => item.branch === branch)
      ? "ambiguous"
      : "none";
  const context =
    identity?.pane_id && newest
      ? usage.contexts?.find(
          (c) =>
            c.connection_id === identity.connection_id &&
            c.connection_generation === identity.connection_generation &&
            c.pane_id === identity.pane_id &&
            c.harness === newest.harness,
        )
      : undefined;
  const times = [
    ...rows.flatMap((r) => [r.first_at, r.last_at]),
    ...spans.flat(),
  ];
  const midnight = Date.parse(facts[0]!.day);
  return {
    source: rows.length ? "session-log" : "world",
    harness,
    models: [...models.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([model]) => model)
      .slice(0, 8),
    role,
    branch,
    pull_request: pr ? { key: pr.key, number: pr.number ?? null } : null,
    attribution,
    calls: rows.length ? rows.reduce((s, r) => s + r.responses, 0) : null,
    // Older activity rows carry no spans: their day stands in for the times.
    first_at: times.length ? Math.min(...times) : midnight,
    last_at: times.length ? Math.max(...times) : midnight,
    max_prompt_tokens: prompt,
    spans,
    context: context
      ? {
          used_tokens: context.used_tokens,
          window_tokens: context.window_tokens,
        }
      : null,
  };
}
function emptyIdentity(
  connection: string,
  generation: number,
): UsageAnalyticsIdentity {
  return {
    connection_id: connection,
    connection_generation: generation,
    agent_id: null,
    pane_id: null,
    workspace_id: null,
    project_id: null,
  };
}
export function usageProject(
  connection: string,
  generation: number,
  common: string,
  label: string,
): UsageProject {
  return {
    id: `project_${usageDigest(JSON.stringify([connection, common]))}`,
    connection_id: connection,
    connection_generation: generation,
    label: label.slice(0, 160),
  };
}
