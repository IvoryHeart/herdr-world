import type {
  HostResources,
  OperationOptions,
  RuntimeOperations,
  RuntimePorts,
  SessionProducers,
} from "./runtime-ports";

/** Untyped native replies are confined to the TUI provider/legacy escape hatch. */
export type TuiControlClient = {
  call(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
    beforeSend?: () => void,
    signal?: AbortSignal,
  ): Promise<any>;
};
export type HerdrRuntimeContext<Viewer> = {
  client: TuiControlClient;
  /** Deferred because the existing bridge also consumes the control ports. */
  terminalBridge(): {
    handleTerminalRpc(
      viewer: Viewer,
      id: string,
      method: string,
      params: Record<string, unknown>,
      current: () => boolean,
    ): Promise<unknown>;
    cleanupWs(viewer: Viewer): void;
    dispose(): void;
  };
};

/** The only translation from shared operations to TUI control-socket RPC. */
export function createHerdrControlPorts(client: TuiControlClient) {
  const invoke = <Result>(
    method: string,
    params: object = {},
    options?: OperationOptions,
  ): Promise<Result> => {
    const query = params as Record<string, unknown>;
    if (options?.signal !== undefined)
      return client.call(
        method,
        query,
        options.timeoutMs,
        options.beforeSend,
        options.signal,
      );
    if (options?.beforeSend !== undefined)
      return client.call(method, query, options.timeoutMs, options.beforeSend);
    if (options?.timeoutMs !== undefined)
      return client.call(method, query, options.timeoutMs);
    return client.call(method, query);
  };
  const operations: RuntimeOperations = {
    listWorkspaces: (query, options) =>
      invoke("workspace.list", query, options),
    getWorkspace: (target, options) => invoke("workspace.get", target, options),
    listTabs: (query, options) => invoke("tab.list", query, options),
    listTerminals: (query, options) => invoke("pane.list", query, options),
    getTerminal: (target, options) => invoke("pane.get", target, options),
    listAgents: (query, options) => invoke("agent.list", query, options),
    getAgent: (target, options) => invoke("agent.get", target, options),
    readTerminal: (target, options) => invoke("pane.read", target, options),
    terminalLayout: (target, options) => invoke("pane.layout", target, options),
  };
  const sessions: SessionProducers = {
    reportMetadata: (report, options) =>
      invoke("pane.report_metadata", report, options),
    reportSession: ({ sessionId, ...report }, options) =>
      invoke(
        "pane.report_agent_session",
        { ...report, agent_session_id: sessionId },
        options,
      ),
  };
  const resources: HostResources = {
    getWorkspace: operations.getWorkspace,
    listWorkspaces: operations.listWorkspaces,
    listTerminals: operations.listTerminals,
    getTerminal: operations.getTerminal,
    listWorktrees: (target, options) =>
      invoke("worktree.list", target, options),
  };
  return { operations, sessions, resources };
}

export function createHerdrRuntimePorts<Viewer>(
  context: HerdrRuntimeContext<Viewer>,
): RuntimePorts<Viewer> {
  return {
    ...createHerdrControlPorts(context.client),
    terminals: {
      dispatch: (viewer, id, verb, params, current) =>
        context
          .terminalBridge()
          .handleTerminalRpc(viewer, id, `terminal.${verb}`, params, current),
      closeViewer: (viewer) => context.terminalBridge().cleanupWs(viewer),
      dispose: () => context.terminalBridge().dispose(),
    },
  };
}

export type TuiPassThrough = { kind: "herdr"; call: TuiControlClient["call"] };

/** Remaining legacy areas must opt into this TUI-only escape hatch. */
export function createTuiPassThrough(
  kind: string,
  client: TuiControlClient,
): TuiPassThrough {
  if (kind !== "herdr") throw new Error("Raw runtime RPC is TUI-only");
  return { kind: "herdr", call: (...args) => client.call(...args) };
}
