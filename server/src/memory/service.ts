import { posix as path } from "node:path";
import {
  MEMORY_ACTIONS,
  MEMORY_LIMITS,
  MEMORY_HARNESSES,
  MemoryError,
  type MemoryAction,
  type MemoryAgent,
  type MemoryCatalog,
  type MemoryEntry,
  type MemoryProject,
  type MemoryRead,
  type MemorySearch,
  type MemorySource,
  type MemoryTarget,
} from "../../../shared/memory";
import type { RuntimeOperations } from "../adapters/runtime-ports";
import { harnessName, harnessOfArgv } from "../herdr-core/harness";
import {
  MEMORY_ADAPTERS,
  memorySources,
  type HostEnvironment,
} from "./adapters";
import type { MemoryHost } from "./host";
import { memoryLoadEvidence } from "./load-evidence";

export type MemoryLease = {
  generation: number;
  isCurrent(): boolean;
  runtime: {
    operations: Pick<RuntimeOperations, "listWorkspaces" | "listTerminals">;
    memoryHost: MemoryHost;
  };
};
const required = (value: unknown, name: string, max = 256): string => {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > max ||
    /[\x00-\x1f]/.test(value)
  )
    throw new MemoryError("invalid", `Invalid ${name}`);
  return value;
};
function absolute(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    value.length <= 4096 &&
    !/[\x00-\x1f]/.test(value)
  );
}
function entryPath(value: unknown, rule = false): string {
  const result = required(value, "path", 1024);
  if (
    result.startsWith("/") ||
    result.includes("\\") ||
    result.split("/").some((part) => !part || part === "." || part === "..") ||
    !(rule ? /\.mdc?$/i : /\.md$/i).test(result) ||
    result.split("/").length > MEMORY_LIMITS.depth + 1
  )
    throw new MemoryError(
      "invalid",
      "Entry must be a relative Markdown filename without traversal",
    );
  return result;
}
export function memoryTarget(params: Record<string, unknown>): MemoryTarget {
  const id = required(params.connection_id, "connection_id");
  const generation = params.connection_generation;
  if (
    typeof generation !== "number" ||
    !Number.isSafeInteger(generation) ||
    generation < 0
  )
    throw new MemoryError(
      "invalid",
      "An observed connection_generation is required",
    );
  return { connection_id: id, connection_generation: generation };
}

/** No persisted content cache. Every call resolves the exact live owner anew. */
export class MemoryService {
  private tails = new Map<string, Promise<unknown>>();
  private active = 0;
  constructor(
    private readonly deps: {
      lease(id: string): MemoryLease | null;
      now?(): number;
    },
  ) {}

  async call(
    action: MemoryAction,
    params: Record<string, unknown>,
    recheck: () => void = () => {},
  ): Promise<unknown> {
    if (!MEMORY_ACTIONS.includes(action))
      throw new MemoryError("invalid", "Unknown memory action");
    const where = memoryTarget(params);
    const mutation =
      action === "create" || action === "update" || action === "delete";
    if (mutation) {
      if (params.user_action !== true)
        throw new MemoryError("refused", "An explicit user action is required");
      if (action === "delete" && params.confirmed !== true)
        throw new MemoryError("refused", "Deletion requires confirmation");
      if (
        action !== "create" &&
        !/^[a-f0-9]{64}$/.test(String(params.revision))
      )
        throw new MemoryError(
          "invalid",
          "A revision from memory read is required",
        );
      if (
        action !== "delete" &&
        (typeof params.content !== "string" || params.content.includes("\0"))
      )
        throw new MemoryError(
          "invalid",
          "Memory content must be UTF-8 text without NUL",
        );
      if (
        typeof params.content === "string" &&
        Buffer.byteLength(params.content) > MEMORY_LIMITS.file_bytes
      )
        throw new MemoryError(
          "too_large",
          "Memory entry exceeds the byte limit",
        );
    }
    if (this.active >= 8)
      throw new MemoryError(
        "unavailable",
        "Too many memory requests; finish existing calls first",
      );
    this.active++;
    try {
      const execute = () => this.execute(action, params, where, recheck);
      if (!mutation) return await execute();
      const previous = this.tails.get(where.connection_id) ?? Promise.resolve();
      const result = previous.catch(() => {}).then(execute);
      this.tails.set(where.connection_id, result);
      try {
        return await result;
      } finally {
        if (this.tails.get(where.connection_id) === result)
          this.tails.delete(where.connection_id);
      }
    } finally {
      this.active--;
    }
  }

  private async execute(
    action: MemoryAction,
    params: Record<string, unknown>,
    where: MemoryTarget,
    recheck: () => void,
  ) {
    let lease: MemoryLease | null;
    try {
      lease = this.deps.lease(where.connection_id);
    } catch {
      lease = null;
    }
    if (
      !lease ||
      lease.generation !== where.connection_generation ||
      !lease.isCurrent()
    )
      throw new MemoryError(
        "unavailable",
        "Memory connection is disconnected or its generation changed; refresh it",
      );
    const captured = lease;
    const current = () => {
      recheck();
      if (!captured.isCurrent())
        throw new MemoryError(
          "unavailable",
          "Memory connection changed; refresh it",
        );
    };
    const host = captured.runtime.memoryHost;
    const run = async <T>(request: Record<string, unknown>): Promise<T> => {
      current();
      const result = await host.execute<T>(request);
      current();
      return result;
    };
    current();
    const [workspaceResult, paneResult] = await Promise.all([
      captured.runtime.operations.listWorkspaces({}, { timeoutMs: 5000 }),
      captured.runtime.operations.listTerminals({}, { timeoutMs: 5000 }),
    ]);
    current();
    const workspaceRows = workspaceResult.workspaces ?? [];
    const paneRows = paneResult.panes ?? [];
    let truncated =
      workspaceRows.length > MEMORY_LIMITS.projects ||
      paneRows.length > MEMORY_LIMITS.agents;
    const projects: MemoryProject[] = workspaceRows
      .slice(0, MEMORY_LIMITS.projects)
      .flatMap((row) => {
        const pane = paneRows.find(
          (pane) =>
            pane.workspace_id === row.workspace_id &&
            (absolute(pane.foreground_cwd) || absolute(pane.cwd)),
        );
        const root =
          row.worktree?.checkout_path ||
          row.cwd ||
          pane?.foreground_cwd ||
          pane?.cwd;
        return typeof row.workspace_id === "string" && absolute(root)
          ? [
              {
                id: row.workspace_id,
                label: String(row.label ?? row.name ?? row.workspace_id).slice(
                  0,
                  200,
                ),
                path: path.normalize(root),
              },
            ]
          : [];
      });
    const agents: MemoryAgent[] = paneRows
      .slice(0, MEMORY_LIMITS.agents)
      .flatMap((row) => {
        const project = projects.find(
          (project) => project.id === row.workspace_id,
        );
        const cwd = row.foreground_cwd || row.cwd || project?.path;
        const id = row.pane_id ?? row.terminal_id;
        return project && typeof id === "string" && absolute(cwd)
          ? [
              {
                id,
                project_id: project.id,
                path: path.normalize(cwd),
                harness:
                  harnessName(
                    row.agent_type ?? row.agent ?? row.harness ?? row.app,
                  ) ?? harnessOfArgv(row.command ?? row.argv),
              },
            ]
          : [];
      });
    if (
      params.workspace_id !== undefined &&
      !projects.some((project) => project.id === params.workspace_id)
    )
      throw new MemoryError(
        "not_found",
        "Project is not in current bounded topology",
      );
    if (
      params.agent_id !== undefined &&
      !agents.some((agent) => agent.id === params.agent_id)
    )
      throw new MemoryError(
        "not_found",
        "Agent is not in current bounded topology",
      );
    const env = await run<HostEnvironment>({
      action: "environment",
      paths: [
        ...new Set([
          ...projects.map((p) => p.path),
          ...agents.map((a) => a.path),
        ]),
      ],
    });
    const all = memorySources(projects, agents, env);
    truncated ||= all.length > MEMORY_LIMITS.sources;
    const selected = all
      .slice(0, MEMORY_LIMITS.sources)
      .filter(
        (source) =>
          (params.workspace_id === undefined ||
            source.project_ids.includes(String(params.workspace_id))) &&
          (params.agent_id === undefined ||
            source.agent_ids.includes(String(params.agent_id))) &&
          (params.harness === undefined ||
            source.harnesses.includes(params.harness as never)),
      );
    if (
      params.harness !== undefined &&
      !MEMORY_ADAPTERS.some((adapter) => adapter.harness === params.harness)
    )
      throw new MemoryError(
        "invalid",
        `Unsupported memory harness; use ${MEMORY_HARNESSES.join(", ")}`,
      );
    if (action === "list" || action === "search") {
      const listed = await run<{
        states: Pick<MemorySource, "id" | "state" | "reason">[];
        entries: MemoryEntry[];
        truncated: boolean;
      }>({ action: "list", sources: selected });
      const now = this.deps.now?.() ?? Date.now();
      const entries = listed.entries.map((entry) => ({
        ...entry,
        age_ms: Math.max(0, now - entry.modified_at),
        stale: now - entry.modified_at >= MEMORY_LIMITS.stale_ms,
      }));
      memoryLoadEvidence(entries, selected);
      const catalog: MemoryCatalog = {
        ...where,
        observed_at: now,
        projects,
        agents,
        sources: selected.map((source) => ({
          ...source,
          ...listed.states.find((state) => state.id === source.id),
        })),
        entries,
        unsupported: agents
          .filter(
            (agent) =>
              !MEMORY_ADAPTERS.some(
                (adapter) => adapter.harness === agent.harness,
              ),
          )
          .map((agent) => ({
            agent_id: agent.id,
            harness: agent.harness,
            reason: "No memory adapter for this observed harness",
          })),
        warnings: [
          "Candidates describe the next load, not a running session's context. Restart or reload in the harness after editing.",
          "Per-process environment, trust, imports, additional directories, project settings and custom fallback names are not resolved. Rules may be conditional; Codex overrides take precedence; memory use may be disabled.",
          "Sharing covers current bounded topology on this connection only. Modification age is not semantic staleness; host clocks may differ.",
        ],
        truncated: truncated || listed.truncated,
        limits: MEMORY_LIMITS,
      };
      if (action === "list") return catalog;
      const query = required(
        params.query,
        "query",
        MEMORY_LIMITS.query_chars,
      ).trim();
      if (!query)
        throw new MemoryError("invalid", "Search query cannot be blank");
      return {
        ...where,
        ...(await run<Omit<MemorySearch, keyof MemoryTarget>>({
          action: "search",
          query,
          sources: catalog.sources,
          entries: catalog.entries,
          truncated: catalog.truncated,
        })),
      };
    }
    const sourceId = required(params.source_id, "source_id");
    const source = selected.find((source) => source.id === sourceId);
    if (!source)
      throw new MemoryError(
        "not_found",
        "Source is no longer discoverable; list memory again",
      );
    const relative = entryPath(
      params.path,
      action === "read" &&
        source.kind === "rules" &&
        source.harnesses.some((h) => h === "cursor" || h === "omp"),
    );
    if (source.shape === "file" && relative !== path.basename(source.path))
      throw new MemoryError(
        "refused",
        "Entry is outside this instruction source",
      );
    if (action === "read") {
      const read = await run<
        Omit<MemoryRead, keyof MemoryTarget | "source_id" | "path">
      >({ action, source, path: relative });
      return { ...where, source_id: source.id, path: relative, ...read };
    }
    current();
    const result = await host.execute<Record<string, unknown>>({
      action,
      source,
      path: relative,
      content: params.content,
      revision: params.revision,
      user_action: true,
      confirmed: params.confirmed,
    });
    try {
      current();
    } catch {
      throw new MemoryError(
        "uncertain",
        "Connection changed after write dispatch; read before retrying",
      );
    }
    return { ...where, source_id: source.id, path: relative, ...result };
  }
}
