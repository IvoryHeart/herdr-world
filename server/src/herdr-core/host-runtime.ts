import type {
  HostResources,
  ListQuery,
  RuntimeOperations,
  TerminalRow,
  WorkspaceRow,
} from "../adapters/runtime-ports";
import { createWorktreeGit } from "../agent/worktree-git";
import { createAgentWorktree } from "../agent/worktree";
import { bindSshCommand } from "../bridge/ssh-sessions";
import {
  type GuiSettings,
  repoWorktreeHooksEnabled,
} from "../config/gui-settings";
import type { ReadyRuntimeLease } from "../connections/manager";
import type { ConnectionIdentity } from "../connections/types";
import { unixOnlyHandlers } from "../connections/unix-only";
import {
  runProcess as runProcessBase,
  runProcessWithCode as runProcessWithCodeBase,
  runProcessWithCodeTimeout as runProcessWithCodeTimeoutBase,
  shQuote,
} from "../utils/process-utils";
import {
  runBinaryProcessWithTimeout as runBinaryProcessWithTimeoutBase,
  runProcessWithInputTimeout as runProcessWithInputTimeoutBase,
} from "../workspace/process";
import { createFileHandlers } from "../workspace/files";
import { createWorktreeHookRunner } from "../worktree/worktree-hooks";
import { CoreUnavailableError } from "./client";
import type { CoreHost } from "./host";
import { readCoreScreen, type CoreConnectionRuntime } from "./runtime";

type Lease = ReadyRuntimeLease<CoreConnectionRuntime>;

/** What a core connection's host consumers run processes with. */
export type CoreHostProcesses = {
  runProcess: typeof runProcessBase;
  runProcessWithCode: typeof runProcessWithCodeBase;
  runProcessWithCodeTimeout: typeof runProcessWithCodeTimeoutBase;
  runBinaryProcessWithTimeout: typeof runBinaryProcessWithTimeoutBase;
  runProcessWithInputTimeout: typeof runProcessWithInputTimeoutBase;
};

/**
 * World's host consumers for one generation of a herdr-core connection
 * (P4): Files, Git, worktree hooks, an agent's worktree and Ranger's reads,
 * as a Herdr (TUI) connection runtime offers them. Rows come from World's
 * read model of that core, never from core's own `file.*`; files and Git
 * run through World's existing guarded host helpers on the core's host.
 *
 * Every operation belongs to the lease it was built from: once that
 * generation is retired, nothing here reads or answers again, and a request
 * for another connection or generation is never answered by this one.
 */
export type CoreHostRuntime = ReturnType<typeof createCoreHostRuntime>;

const PANE_NOT_FOUND = "pane_not_found";
const WORKSPACE_NOT_FOUND = "workspace_not_found";

function withinQuery<Row extends { workspace_id?: string; tab_id?: string }>(
  rows: Row[],
  query: ListQuery = {},
): Row[] {
  return rows.filter(
    (row) =>
      (query.workspace_id === undefined ||
        row.workspace_id === query.workspace_id) &&
      (query.tab_id === undefined || row.tab_id === query.tab_id),
  );
}

export function createCoreHostRuntime(args: {
  lease: Lease;
  /** Where the core runs: its SSH destination, or this computer. */
  host: Pick<CoreHost, "destination" | "windows"> | null;
  readSettings(): Promise<GuiSettings>;
  /** Test seam: the process runners (production: World's own). */
  processes?: Partial<CoreHostProcesses>;
}) {
  const { lease } = args;
  const identity: ConnectionIdentity = { ...lease.runtime.identity };
  const destination = args.host?.destination;
  const remotePlatform = args.host?.windows ? ("windows" as const) : undefined;
  const sshHost = () => destination;
  const abort = new AbortController();
  // SSH children belong to this generation: they stop when it retires.
  const forConnection = (argv: string[]) =>
    bindSshCommand(
      argv,
      undefined,
      AbortSignal.any([abort.signal, lease.runtime.signal]),
    );
  const base = args.processes ?? {};
  const guarded = async <T>(operation: () => Promise<T>) => {
    current();
    const value = await operation();
    current();
    return value;
  };
  const runProcess: typeof runProcessBase = (argv, ...rest) =>
    guarded(() =>
      (base.runProcess ?? runProcessBase)(forConnection(argv), ...rest),
    );
  const runProcessWithCode: typeof runProcessWithCodeBase = (argv, ...rest) =>
    guarded(() =>
      (base.runProcessWithCode ?? runProcessWithCodeBase)(
        forConnection(argv),
        ...rest,
      ),
    );
  const runProcessWithCodeTimeout: typeof runProcessWithCodeTimeoutBase = (
    argv,
    ...rest
  ) =>
    guarded(() =>
      (base.runProcessWithCodeTimeout ?? runProcessWithCodeTimeoutBase)(
        forConnection(argv),
        ...rest,
      ),
    );
  const runBinaryProcessWithTimeout: typeof runBinaryProcessWithTimeoutBase = (
    argv,
    ...rest
  ) =>
    guarded(() =>
      (base.runBinaryProcessWithTimeout ?? runBinaryProcessWithTimeoutBase)(
        forConnection(argv),
        ...rest,
      ),
    );
  const runProcessWithInputTimeout: typeof runProcessWithInputTimeoutBase = (
    argv,
    ...rest
  ) =>
    guarded(() =>
      (base.runProcessWithInputTimeout ?? runProcessWithInputTimeoutBase)(
        forConnection(argv),
        ...rest,
      ),
    );

  /** This generation, still current; else nothing is read or answered. */
  const current = () => {
    if (!lease.isCurrent() || !lease.runtime.core.actionable) {
      abort.abort(new Error("herdr-core connection changed"));
      throw new CoreUnavailableError(
        "The host's herdr-core reconnected; look again and retry.",
      );
    }
  };
  const reader = lease.runtime.operations;
  async function workspaces(): Promise<WorkspaceRow[]> {
    current();
    const rows = (await reader.listWorkspaces()).workspaces ?? [];
    current();
    return rows;
  }
  /**
   * Terminal rows with the program occupying each address now: its pid and
   * the mirror's occupancy token, which changes when core restarts or
   * replaces the program (even one that reuses the pid). Bindings made from
   * a row (an agent's worktree) hold only while it does.
   */
  async function panes(query?: ListQuery): Promise<TerminalRow[]> {
    current();
    const rows = (await reader.listTerminals()).panes ?? [];
    current();
    return withinQuery(rows, query).map((row) => {
      const address = String(row.pane_id ?? "");
      const occupancy = lease.runtime.core.occupancy(address);
      const pid = lease.runtime.core.terminal(address)?.pid;
      return occupancy === null
        ? row
        : {
            ...row,
            occupant: `${typeof pid === "number" ? pid : "-"}:${occupancy}`,
          };
    });
  }

  const operations: RuntimeOperations = {
    listWorkspaces: async () => ({ workspaces: await workspaces() }),
    getWorkspace: async ({ workspace_id }) => {
      const workspace = (await workspaces()).find(
        (row) => row.workspace_id === workspace_id,
      );
      if (!workspace)
        throw new Error(`${WORKSPACE_NOT_FOUND}: ${String(workspace_id)}`);
      return { workspace };
    },
    listTabs: async (query) => {
      current();
      const rows = (await reader.listTabs()).tabs ?? [];
      current();
      return {
        tabs: withinQuery(
          rows as Array<{ workspace_id?: string; tab_id?: string }>,
          query,
        ),
      };
    },
    listTerminals: async (query) => ({ panes: await panes(query) }),
    getTerminal: async ({ pane_id }) => {
      const pane = (await panes()).find((row) => row.pane_id === pane_id);
      if (!pane) throw new Error(`${PANE_NOT_FOUND}: ${String(pane_id)}`);
      return { pane };
    },
    listAgents: async (query) => {
      current();
      const rows = (await reader.listAgents()).agents ?? [];
      current();
      return {
        agents: withinQuery(
          rows as Array<{ workspace_id?: string; tab_id?: string }>,
          query,
        ),
      };
    },
    // Screen only (`lines: 0`): core's history read of a full-screen app
    // scrolls it (holds keys, injects wheel input), so it is never a read.
    readTerminal: async ({ pane_id }) => {
      current();
      const screen = await readCoreScreen(lease, pane_id);
      // Where it is now: published only if it is still in this read model.
      const pane = (await panes()).find((row) => row.pane_id === pane_id);
      if (!pane) throw new Error(`${PANE_NOT_FOUND}: ${String(pane_id)}`);
      return {
        read: {
          pane_id,
          workspace_id: pane.workspace_id,
          source: "screen",
          text: typeof screen.text === "string" ? screen.text : "",
          truncated: screen.complete !== true,
        },
      };
    },
    // A core terminal's agent is its row's harness (topology.ts).
    getAgent: async ({ target }) => {
      current();
      const rows = (await reader.listAgents()).agents ?? [];
      current();
      const agent = rows.find(
        (row) => row.pane_id === target || row.terminal_id === target,
      );
      if (!agent) throw new Error(`${PANE_NOT_FOUND}: ${String(target)}`);
      return { agent };
    },
    terminalLayout: async () => {
      throw new Error("herdr-core terminals have no Herdr pane layout");
    },
  };

  const worktreeGit = createWorktreeGit({
    sshHost,
    shQuote,
    runProcessWithCodeTimeout,
  });
  const resources: HostResources = {
    getWorkspace: operations.getWorkspace,
    listWorkspaces: operations.listWorkspaces,
    listTerminals: operations.listTerminals,
    getTerminal: operations.getTerminal,
    // Herdr's `worktree.list`, from Git on the core's host.
    listWorktrees: async ({ workspace_id }) => {
      const { workspace } = await operations.getWorkspace({ workspace_id });
      const folder =
        workspace?.worktree?.checkout_path ||
        workspace?.cwd ||
        (await panes({ workspace_id })).find((pane) => pane.cwd)?.cwd;
      const root = folder ? await worktreeGit.inspect(folder) : null;
      current();
      if (!root) return { worktrees: [] };
      const listed = await worktreeGit.list(root.canonicalRoot);
      current();
      return {
        worktrees: listed.map((entry) => ({
          path: entry.path,
          branch: entry.branch,
          ...(entry.bare ? { is_bare: true } : {}),
          ...(entry.prunable ? { is_prunable: true } : {}),
        })),
      };
    },
  };

  const readSettings = async () => {
    const settings = await args.readSettings();
    current();
    return settings;
  };
  const agentWorktree = unixOnlyHandlers(
    remotePlatform,
    "Agent worktree",
    createAgentWorktree({
      connectionId: identity.id,
      generation: lease.generation,
      resources,
      ...worktreeGit,
      // Core terminals carry no transcript-bound session evidence yet (M4):
      // only the live terminal's own folder and Git are evidence.
      readSessionMetadata: async () => null,
    }),
  );
  const files = unixOnlyHandlers(
    remotePlatform,
    "Workspace file and Git access",
    createFileHandlers({
      resources,
      sshHost,
      runProcessWithCodeTimeout,
      runProcessWithInputTimeout,
      runBinaryProcessWithTimeout,
      bindProcess: forConnection,
      shQuote,
      resolveAgentWorktreeTarget: agentWorktree.resolve,
    }),
  );
  const worktreeHooks = unixOnlyHandlers(
    remotePlatform,
    "Worktree hook access",
    createWorktreeHookRunner({
      connectionId: identity.id,
      resources,
      sshHost,
      runProcess,
      runProcessWithCode,
      shQuote,
      hooksEnabled: (repoKey) =>
        repoWorktreeHooksEnabled(readSettings, repoKey),
    }),
  );
  return {
    runtime: "herdr-core" as const,
    identity,
    generation: lease.generation,
    lease,
    isCurrent: () => lease.isCurrent(),
    remotePlatform,
    sshHost,
    runProcessWithCodeTimeout,
    readSettings,
    operations,
    resources,
    files,
    agentWorktree,
    worktreeHooks,
    worktreeGit,
    /** No Git status badges are kept for core rooms: nothing to refresh. */
    status: {
      invalidateGitStatus: (workspaceId?: unknown) => {
        void workspaceId;
      },
      invalidateWorkspaceGitStatus: (workspaceId?: unknown) => {
        void workspaceId;
      },
    },
    /** Stops this generation's host processes. */
    retire: () => abort.abort(new Error("herdr-core connection retired")),
  };
}

/**
 * One host runtime per core runtime generation: a reconnect gets a new
 * one, and the retired one is never reused for it.
 */
export function coreHostRuntimes(args: {
  host(connectionId: string): Pick<CoreHost, "destination" | "windows"> | null;
  readSettings(connectionId: string): Promise<GuiSettings>;
  processes?: Partial<CoreHostProcesses>;
}) {
  const runtimes = new WeakMap<CoreConnectionRuntime, CoreHostRuntime>();
  return (lease: Lease): CoreHostRuntime => {
    if (!lease.isCurrent())
      throw new CoreUnavailableError(
        "The host's herdr-core reconnected; look again and retry.",
      );
    const known = runtimes.get(lease.runtime);
    if (known && known.generation === lease.generation) return known;
    known?.retire();
    const made = createCoreHostRuntime({
      lease,
      host: args.host(lease.runtime.identity.id),
      readSettings: () => args.readSettings(lease.connectionId),
      ...(args.processes ? { processes: args.processes } : {}),
    });
    runtimes.set(lease.runtime, made);
    return made;
  };
}
