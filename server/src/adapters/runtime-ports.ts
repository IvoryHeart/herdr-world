/** Operations belong to the captured connection/runtime, never a global client. */
export type OperationOptions = {
  timeoutMs?: number;
  beforeSend?: () => void;
  signal?: AbortSignal;
};

export type RuntimeRow = Record<string, unknown>;
export type WorkspaceRow = RuntimeRow & {
  workspace_id?: string;
  focused?: boolean;
  cwd?: string;
  worktree?: RuntimeRow & {
    repo_name?: string;
    checkout_path?: string;
    is_linked_worktree?: boolean;
  };
};
export type TerminalRow = RuntimeRow & {
  pane_id?: string;
  terminal_id?: string;
  workspace_id?: string;
  tab_id?: string;
  focused?: boolean;
  cwd?: string;
  foreground_cwd?: string;
};
export type ListQuery = { workspace_id?: string; tab_id?: string };

/** Replies retain World topology fields; consumers still validate source evidence. */
export type RuntimeOperations = {
  listWorkspaces(
    query?: ListQuery,
    options?: OperationOptions,
  ): Promise<{ workspaces?: WorkspaceRow[] }>;
  getWorkspace(
    target: { workspace_id?: string },
    options?: OperationOptions,
  ): Promise<RuntimeRow & { workspace?: WorkspaceRow }>;
  listTabs(
    query?: ListQuery,
    options?: OperationOptions,
  ): Promise<{ tabs?: RuntimeRow[] }>;
  listTerminals(
    query?: ListQuery,
    options?: OperationOptions,
  ): Promise<{ panes?: TerminalRow[] }>;
  getTerminal(
    target: { pane_id: string },
    options?: OperationOptions,
  ): Promise<RuntimeRow & { pane?: TerminalRow }>;
  listAgents(
    query?: ListQuery,
    options?: OperationOptions,
  ): Promise<{ agents?: RuntimeRow[] }>;
  getAgent(
    target: { target: string },
    options?: OperationOptions,
  ): Promise<{ agent?: RuntimeRow }>;
  readTerminal(
    target: {
      pane_id: string;
      source?: string;
      strip_ansi?: boolean;
      lines?: number;
      format?: string;
    },
    options?: OperationOptions,
  ): Promise<RuntimeRow>;
  terminalLayout(
    target: { pane_id: string },
    options?: OperationOptions,
  ): Promise<{
    layout?: { area?: { x: number; y: number; width: number; height: number } };
  }>;
};

export type SessionProducers = {
  reportMetadata(
    report: {
      pane_id: string;
      source: string;
      tokens: Record<string, string | null>;
      ttl_ms?: number;
    },
    options?: OperationOptions,
  ): Promise<unknown>;
  reportSession(
    report: {
      pane_id: string;
      source: string;
      agent: string;
      sessionId: string;
    },
    options?: OperationOptions,
  ): Promise<unknown>;
};

/** Resolve runtime identities before using World's existing guarded host helpers. */
export type HostResources = Pick<
  RuntimeOperations,
  "getWorkspace" | "listWorkspaces" | "listTerminals" | "getTerminal"
> & {
  listWorktrees(
    target: { workspace_id: string },
    options?: OperationOptions,
  ): Promise<{
    worktrees?: Array<
      RuntimeRow & { path: string; is_bare?: boolean; is_prunable?: boolean }
    >;
  }>;
};

export type TerminalStreamVerb =
  | "attach"
  | "detach"
  | "input"
  | "resize"
  | "scroll"
  | "focus"
  | "relay_resize"
  | "link.resolve";

export function terminalStreamVerb(method: string): TerminalStreamVerb | null {
  switch (method) {
    case "terminal.attach":
      return "attach";
    case "terminal.detach":
      return "detach";
    case "terminal.input":
      return "input";
    case "terminal.resize":
      return "resize";
    case "terminal.scroll":
      return "scroll";
    case "terminal.focus":
      return "focus";
    case "terminal.relay_resize":
      return "relay_resize";
    case "terminal.link.resolve":
      return "link.resolve";
    default:
      return null;
  }
}
/** The viewer owns an independent attachment; its runtime owns final disposal. */
export type TerminalStreams<Viewer> = {
  dispatch(
    viewer: Viewer,
    id: string,
    verb: TerminalStreamVerb,
    params: Record<string, unknown>,
    isCurrent: () => boolean,
  ): Promise<unknown>;
  closeViewer(viewer: Viewer): void;
  dispose(): void;
};

export type RuntimePorts<Viewer = never> = {
  operations: RuntimeOperations;
  sessions: SessionProducers;
  resources: HostResources;
  terminals: TerminalStreams<Viewer>;
};

export type RuntimeReader = Pick<
  RuntimeOperations,
  "listWorkspaces" | "listTabs" | "listTerminals" | "listAgents"
>;

/** One observation slot includes every sibling, even if a required read fails. */
export async function readRuntimeSnapshot(
  operations: RuntimeReader,
): Promise<readonly [unknown, unknown, unknown, unknown]> {
  const options = { timeoutMs: 5_000 };
  const results = await Promise.allSettled([
    operations.listWorkspaces({}, options),
    operations.listTabs({}, options),
    operations.listTerminals({}, options),
    operations.listAgents({}, options),
  ]);
  const [workspaces, tabs, panes, agents] = results;
  if (workspaces.status === "rejected") throw workspaces.reason;
  if (tabs.status === "rejected") throw tabs.reason;
  if (panes.status === "rejected") throw panes.reason;
  return [
    workspaces.value,
    tabs.value,
    panes.value,
    agents.status === "fulfilled" ? agents.value : null,
  ];
}
