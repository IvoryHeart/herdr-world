import { readFileSync, statSync } from "node:fs";
import { replaceDataFile } from "../config/data-paths";
import type { UsageAnalyticsIdentity } from "../../../shared/usageAnalytics";
import { usageDigest } from "./host";
import { harnessName } from "../herdr-core/harness";
import {
  joinUsageSpans,
  validUsageSpans,
  type UsageSpan,
} from "../../../shared/usageSpans";

const DAY = 86_400_000;
const MAX_ROWS = 8192;
/** An observation is never carried through a long gap without fresh evidence. */
const LEASE_MS = 15_000;
/**
 * Working spans join only where they touch: an observed idle or blocked gap,
 * however short, is not working time, and filling it would invent overlap
 * with another agent's work. A row keeps at most this many spans; past it
 * the two closest join (the bound, documented in docs/usage-analytics.md).
 */
const SPAN_GAP_MS = 0;
const SPAN_LIMIT = 48;
/** The history file's size limit, for reading and writing alike. */
const MAX_FILE_BYTES = 4 * 1024 * 1024;
/** Agent→run and run→item links kept, newest last. */
const MAX_LINKS = 4096;
const RUN_ID = /^run_[a-f0-9]{64}$/;
export type ActivityRow = UsageAnalyticsIdentity & {
  day: string;
  active_ms: number;
  waiting_on_you_ms: number;
  observed_ms: number;
  /** World's name for the agent's harness; null when it names none known. */
  harness?: string | null;
  /** When World saw the agent working that day: sorted, bounded spans. */
  spans?: UsageSpan[];
};
type Live = {
  identity: UsageAnalyticsIdentity;
  harness: string | null;
  at: number;
  until: number;
  status: string;
};
export const analyticsAgentId = (
  connection: string,
  generation: number,
  pane: Record<string, unknown>,
) => {
  const session = pane.core_occupant_fingerprint ?? pane.agent_session;
  return typeof pane.terminal_id === "string" && session
    ? `agent_${usageDigest(JSON.stringify([connection, generation, pane.terminal_id, pane.agent, session]))}`
    : null;
};

/** Numeric daily history only. Live intervals are deliberately never restored. */
export class UsageActivity {
  private rows = new Map<string, ActivityRow>();
  private live = new Map<string, Live>();
  private projects = new Map<string, string>();
  private locations = new Map<string, string>();
  private lastObserved = new Map<string, number>();
  /** An agent's transcript run, learnt while both were current. */
  private runs = new Map<string, string>();
  /** A run's pull request, from a session-validated work link. */
  private items = new Map<string, string>();
  truncated = false;
  history: "available" | "unavailable" = "available";
  private closed = false;
  observeFresh(
    connection: string,
    generation: number,
    panes: readonly Record<string, unknown>[],
    at: number,
    agents: readonly Record<string, unknown>[],
  ) {
    const byPane = new Map(agents.map((a) => [a.pane_id, a]));
    this.observe(
      connection,
      generation,
      panes.map((p) => ({ ...p, ...byPane.get(p.pane_id) })),
      at,
    );
  }
  constructor(private readonly path?: string) {
    if (!path) return;
    try {
      if (statSync(path).size > MAX_FILE_BYTES) throw new Error("size");
      const saved = JSON.parse(readFileSync(path, "utf8"));
      if (
        saved.version !== 1 ||
        !Array.isArray(saved.rows) ||
        saved.rows.length > MAX_ROWS
      )
        throw new Error("format");
      for (const row of saved.rows) {
        if (!validRow(row)) throw new Error("row");
        this.rows.set(JSON.stringify([row.day, identity(row)]), row);
      }
      const links = saved.links ?? { runs: [], items: [] };
      if (
        !Array.isArray(links.runs) ||
        !Array.isArray(links.items) ||
        links.runs.length > MAX_LINKS ||
        links.items.length > MAX_LINKS
      )
        throw new Error("links");
      for (const link of links.runs) {
        if (
          !Array.isArray(link) ||
          !/^agent_[a-f0-9]{64}$/.test(link[0]) ||
          !RUN_ID.test(link[1])
        )
          throw new Error("link");
        this.runs.set(link[0], link[1]);
      }
      for (const link of links.items) {
        if (
          !Array.isArray(link) ||
          !RUN_ID.test(link[0]) ||
          typeof link[1] !== "string" ||
          !link[1] ||
          link[1].length > 512
        )
          throw new Error("link");
        this.items.set(link[0], link[1]);
      }
      this.truncated = saved.truncated === true;
    } catch (error) {
      this.rows.clear();
      this.runs.clear();
      this.items.clear();
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.history = "unavailable";
    }
  }
  observe(
    connection: string,
    generation: number,
    panes: readonly Record<string, unknown>[],
    at: number,
    projects: ReadonlyMap<string, string> = new Map(),
  ) {
    if (this.closed) return;
    at = Math.max(at, this.lastObserved.get(connection) ?? at);
    if (this.lastObserved.size < 16 || this.lastObserved.has(connection))
      this.lastObserved.set(connection, at);
    this.invalidate(connection, at);
    for (const pane of panes.slice(0, 4096)) {
      if (
        typeof pane.pane_id !== "string" ||
        typeof pane.workspace_id !== "string"
      )
        continue;
      const agentId = analyticsAgentId(connection, generation, pane);
      if (!agentId) continue;
      const location = usageDigest(
        String(pane.foreground_cwd ?? pane.cwd ?? ""),
      );
      if (this.locations.get(agentId) !== location)
        this.projects.delete(agentId);
      if (this.locations.size < 4096 || this.locations.has(agentId))
        this.locations.set(agentId, location);
      const target: UsageAnalyticsIdentity = {
        connection_id: connection,
        connection_generation: generation,
        agent_id: agentId,
        pane_id: pane.pane_id,
        workspace_id: pane.workspace_id,
        project_id:
          projects.get(pane.pane_id) ?? this.projects.get(agentId) ?? null,
      };
      // blocked means World needs a person. A provider limit is not owner wait.
      const status =
        pane.agent_status === "blocked" && pane.blocked_kind === "usage_limit"
          ? "unknown"
          : String(pane.agent_status ?? "unknown");
      if (this.live.size >= 4096) {
        this.truncated = true;
        break;
      }
      this.live.set(JSON.stringify([connection, pane.pane_id]), {
        identity: target,
        harness: harnessName(pane.agent),
        at,
        until: at + LEASE_MS,
        status,
      });
    }
    if (panes.length > 4096) this.truncated = true;
    this.prune(at);
  }
  invalidate(connection: string, at: number) {
    if (this.closed) return;
    for (const [key, live] of this.live)
      if (live.identity.connection_id === connection) {
        this.account(live, at);
        this.live.delete(key);
      }
  }
  assignProject(agentId: string, projectId: string, at: number) {
    if (this.closed) return;
    if (this.projects.size >= 4096 && !this.projects.has(agentId)) {
      this.truncated = true;
      return;
    }
    this.projects.set(agentId, projectId);
    for (const live of this.live.values())
      if (
        live.identity.agent_id === agentId &&
        live.identity.project_id !== projectId
      ) {
        this.account(live, at);
        live.identity = { ...live.identity, project_id: projectId };
      }
  }
  /** Remembers an agent's transcript run, learnt while both are current. */
  linkRun(agentId: string, runId: string) {
    if (this.closed || !RUN_ID.test(runId)) return;
    remember(this.runs, agentId, runId);
  }
  /** The transcript run an agent was linked to, if any. */
  runOf(agentId: string) {
    return this.runs.get(agentId) ?? null;
  }
  /** Remembers a run's pull request from a session-validated work link. */
  linkItem(runId: string, itemKey: string) {
    if (this.closed || !RUN_ID.test(runId) || itemKey.length > 512) return;
    remember(this.items, runId, itemKey);
  }
  /** The pull request a run was linked to, if any. */
  itemOf(runId: string) {
    return this.items.get(runId) ?? null;
  }
  private account(live: Live, at: number) {
    const until = Math.min(at, live.until);
    for (let from = live.at; from < until; ) {
      const end = Math.min(until, (Math.floor(from / DAY) + 1) * DAY);
      const row: ActivityRow = {
        ...live.identity,
        day: new Date(from).toISOString().slice(0, 10),
        active_ms: 0,
        waiting_on_you_ms: 0,
        observed_ms: 0,
      };
      const key = JSON.stringify([row.day, identity(row)]);
      const current = this.rows.get(key) ?? row;
      if (!this.rows.has(key) && this.rows.size >= MAX_ROWS) {
        this.truncated = true;
        break;
      }
      if (["working", "blocked", "idle", "done"].includes(live.status)) {
        current.observed_ms += end - from;
        current.harness ??= live.harness;
        if (live.status === "working") {
          current.active_ms += end - from;
          current.spans = joinUsageSpans(
            [...(current.spans ?? []), [from, end]],
            SPAN_GAP_MS,
            SPAN_LIMIT,
          );
        }
        if (live.status === "blocked") current.waiting_on_you_ms += end - from;
        this.rows.set(key, current);
      }
      from = end;
    }
    live.at = Math.max(live.at, until);
    const connection = live.identity.connection_id;
    if (this.lastObserved.size < 16 || this.lastObserved.has(connection))
      this.lastObserved.set(
        connection,
        Math.max(this.lastObserved.get(connection) ?? live.at, live.at),
      );
  }
  private prune(now: number) {
    const from = Math.floor(now / DAY) * DAY - 6 * DAY;
    for (const [key, row] of this.rows)
      if (Date.parse(row.day) < from || Date.parse(row.day) > now)
        this.rows.delete(key);
  }
  read(now: number) {
    if (!this.closed)
      for (const live of this.live.values()) this.account(live, now);
    this.prune(now);
    return structuredClone([...this.rows.values()]);
  }
  save(now: number) {
    let rows = this.read(now);
    let runs = [...this.runs];
    let items = [...this.items];
    // The whole file stays within the limit it is read back under: rows,
    // then links (oldest first), are halved until the envelope fits.
    const envelope = () =>
      JSON.stringify({
        version: 1,
        truncated: this.truncated,
        rows,
        links: { runs, items },
      });
    let text = envelope();
    while (Buffer.byteLength(text) > MAX_FILE_BYTES - 1024) {
      this.truncated = true;
      if (rows.length > 1)
        rows = rows
          .sort((a, b) => b.day.localeCompare(a.day))
          .slice(0, Math.floor(rows.length / 2));
      else if (runs.length || items.length) {
        runs = runs.slice(Math.ceil(runs.length / 2));
        items = items.slice(Math.ceil(items.length / 2));
      } else rows = [];
      text = envelope();
    }
    if (this.path && !this.closed)
      try {
        replaceDataFile(this.path, text);
      } catch {
        this.history = "unavailable";
      }
  }
  close(now: number) {
    this.save(now);
    this.closed = true;
    this.live.clear();
  }
}
function remember(map: Map<string, string>, key: string, value: string) {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_LINKS) map.delete(map.keys().next().value!);
}
/** Only the identity fields of an activity row. */
export function identity(row: UsageAnalyticsIdentity): UsageAnalyticsIdentity {
  const {
    connection_id,
    connection_generation,
    agent_id,
    pane_id,
    workspace_id,
    project_id,
  } = row;
  return {
    connection_id,
    connection_generation,
    agent_id,
    pane_id,
    workspace_id,
    project_id,
  };
}
function validRow(row: ActivityRow) {
  return (
    row &&
    Object.keys(row).length ===
      10 + Number("harness" in row) + Number("spans" in row) &&
    (row.harness === undefined ||
      row.harness === null ||
      (typeof row.harness === "string" &&
        /^[a-z0-9_-]{1,40}$/.test(row.harness))) &&
    (row.spans === undefined || validUsageSpans(row.spans, SPAN_LIMIT)) &&
    typeof row.connection_id === "string" &&
    row.connection_id.length <= 160 &&
    Number.isSafeInteger(row.connection_generation) &&
    row.connection_generation >= 0 &&
    typeof row.agent_id === "string" &&
    /^agent_[a-f0-9]{64}$/.test(row.agent_id) &&
    [row.pane_id, row.workspace_id].every(
      (v) => typeof v === "string" && v.length <= 512,
    ) &&
    (row.project_id === null ||
      /^project_[a-f0-9]{64}$/.test(row.project_id)) &&
    /^\d{4}-\d{2}-\d{2}$/.test(row.day) &&
    Number.isFinite(Date.parse(row.day)) &&
    [row.active_ms, row.waiting_on_you_ms, row.observed_ms].every(
      (v) => Number.isSafeInteger(v) && v >= 0 && v <= DAY,
    ) &&
    row.active_ms + row.waiting_on_you_ms <= row.observed_ms
  );
}
