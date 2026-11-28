import type {
  HostResources,
  OperationOptions,
  RuntimeOperations,
  RuntimePorts,
  SessionProducers,
} from "./runtime-ports";
import { guardAgentInput, isAgentInput } from "./agent-input";
import { localTerminalReaders, type TerminalReaders } from "./terminal-readers";

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
  readers: TerminalReaders = localTerminalReaders,
): TuiPassThrough {
  if (kind !== "herdr") throw new Error("Raw runtime RPC is TUI-only");
  const call: TuiControlClient["call"] = async (
    method,
    params = {},
    ...rest
  ) => {
    if (method === "pane.process_info" && isAgentInput()) {
      const reply = await client.call(method, params, ...rest);
      const info = reply?.process_info;
      if (!info || !Array.isArray(info.foreground_processes)) return reply;
      const flags = await readers(info);
      if (
        flags.length !== info.foreground_processes.length ||
        flags.some((v) => typeof v !== "boolean")
      )
        throw new Error("Unreadable terminal readers");
      return {
        ...reply,
        process_info: {
          ...info,
          foreground_processes: info.foreground_processes.map(
            (p: Record<string, unknown>, i: number) => ({
              ...p,
              reads_terminal: flags[i],
            }),
          ),
        },
      };
    }
    // pane.send_input also carries the owner's explicit Terminal interaction.
    // Only World agent sends opt into foreground admission via async context.
    if (
      method === "agent.prompt" ||
      (method === "pane.send_input" && isAgentInput())
    ) {
      const paneId = await guardAgentInput(
        { call },
        params,
        method === "pane.send_input",
      );
      const native = { ...params };
      return client.call(
        method,
        method === "agent.prompt" ? { ...native, target: paneId } : native,
        ...rest,
      );
    }
    return client.call(method, params, ...rest);
  };
  return { kind: "herdr", call };
}
