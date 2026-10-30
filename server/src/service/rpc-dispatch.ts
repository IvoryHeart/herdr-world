import type { ServerWebSocket } from "bun";
import {
  ConnectionRoutingError,
  createConnectionReplyPublisher,
  type createLegacyRoutingLogger,
  serializeConnectionEnvelope,
  validateConnectionGeneration,
  validateConnectionId,
} from "../connections/protocol";
import {
  type ConnectionRpcRequest,
  isConnectionRpcEnvelope,
  resolveRpcRoute,
} from "../connections/rpc-routing";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import { unixOnlyMessage } from "../connections/unix-only";
import { enrichIntegrationVersions } from "../herdr/integration-versions";
import { handleAgentRpc } from "../rpc/agent";
import { handleBoardTownRpc } from "../rpc/board-town";
import { handleBridgeRpc } from "../rpc/bridge";
import { handleConnectionsRpc } from "../rpc/connections";
import type {
  BridgeRpcContext,
  ConnectionRpcContext,
  RpcServices,
} from "../rpc/context";
import { handleFilesRpc } from "../rpc/files";
import { handleGitRpc } from "../rpc/git";
import { handleLauncherRpc } from "../rpc/launcher";
import { handleWorldRpc } from "../rpc/world";
import { inspectWorkspacePath } from "../workspace/path";

type RpcRequest = ConnectionRpcRequest;
type LegacyRoutingLogger = ReturnType<typeof createLegacyRoutingLogger>;

/**
 * One browser message: routing, then the rpc/ namespace handlers, then the
 * connection's terminal and settings handlers, then Herdr itself.
 */
export function createRpcDispatcher(
  services: RpcServices,
  legacyRoutingLogger: LegacyRoutingLogger,
) {
  return (ws: ServerWebSocket<unknown>, raw: string) =>
    handleRpc(services, legacyRoutingLogger, ws, raw);
}

async function handleRpc(
  services: RpcServices,
  legacyRoutingLogger: LegacyRoutingLogger,
  ws: ServerWebSocket<unknown>,
  raw: string,
) {
  const { connectionManager, markRpcError, safeSend, snapshotAdmission } =
    services;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    safeSend(
      ws,
      JSON.stringify({ error: { message: "bad json" } }),
      "bad-json",
    );
    return;
  }
  if (snapshotAdmission.acknowledge(ws, parsed)) return;
  if (!isConnectionRpcEnvelope(parsed)) {
    safeSend(
      ws,
      JSON.stringify({ error: { message: "invalid request envelope" } }),
      "invalid-request-envelope",
    );
    return;
  }
  const req = parsed as RpcRequest;
  const { id, method } = req;
  let { params } = req;
  let validationConnectionId: string | undefined;
  let connectionIdValidationFailed = false;
  if (Object.hasOwn(req, "connection_id")) {
    try {
      validationConnectionId = validateConnectionId(req.connection_id);
    } catch {
      connectionIdValidationFailed = true;
    }
  }
  let validationConnectionGeneration: number | undefined;
  let connectionGenerationValidationFailed = false;
  if (Object.hasOwn(req, "connection_generation")) {
    try {
      validationConnectionGeneration = validateConnectionGeneration(
        req.connection_generation,
      );
    } catch {
      connectionGenerationValidationFailed = true;
    }
  }
  if (typeof id !== "string" || !id || typeof method !== "string" || !method) {
    const message = connectionIdValidationFailed
      ? "invalid connection_id"
      : connectionGenerationValidationFailed
        ? "invalid connection_generation"
        : "missing id/method";
    markRpcError(ws, typeof id === "string" ? id : undefined, message);
    const responseId = typeof id === "string" ? id : undefined;
    const payload = validationConnectionId
      ? serializeConnectionEnvelope(
          validationConnectionId,
          {
            ...(responseId ? { id: responseId } : {}),
            error: { message },
          },
          validationConnectionGeneration,
        )
      : JSON.stringify({
          ...(responseId ? { id: responseId } : {}),
          error: { message },
        });
    safeSend(ws, payload, "invalid-request");
    return;
  }
  let route: ReturnType<typeof resolveRpcRoute<LegacyConnectionRuntime>>;
  try {
    route = resolveRpcRoute({
      request: req,
      registry: connectionManager,
      legacyClient: ws,
      legacyLogger: legacyRoutingLogger,
    });
  } catch (error) {
    const message = (error as Error).message;
    markRpcError(ws, id, message);
    const connectionId =
      error instanceof ConnectionRoutingError ? error.connectionId : undefined;
    const connectionGeneration =
      error instanceof ConnectionRoutingError
        ? error.connectionGeneration
        : undefined;
    const payload = connectionId
      ? serializeConnectionEnvelope(
          connectionId,
          {
            id,
            error: { message },
          },
          connectionGeneration,
        )
      : JSON.stringify({ id, error: { message } });
    safeSend(ws, payload, "connection-routing-error");
    return connectionId ?? null;
  }
  const connectionId = route.scope === "connection" ? route.connectionId : null;
  const requestIsCurrent = () => route.scope === "bridge" || route.isCurrent();
  const encode = (message: Record<string, unknown>) =>
    route.scope === "connection"
      ? serializeConnectionEnvelope(
          route.connectionId,
          message,
          route.generation,
        )
      : JSON.stringify(message);
  const replyPublisher =
    route.scope === "connection"
      ? createConnectionReplyPublisher({
          connectionId: route.connectionId,
          generation: route.generation,
          requestId: id,
          isCurrent: route.isCurrent,
          send: (payload, context) => safeSend(ws, payload, context),
          markError: (message) => markRpcError(ws, id, message),
        })
      : null;
  const sendReply = (
    message: Record<string, unknown>,
    context: string,
  ): boolean =>
    replyPublisher
      ? replyPublisher.send(message, context)
      : safeSend(ws, encode(message), context);
  const sendError = (context: string, error: unknown) => {
    const message = (error as Error).message;
    markRpcError(ws, id, message);
    sendReply({ id, error: { message } }, context);
  };

  const rpc: BridgeRpcContext = {
    ws,
    req,
    id,
    method,
    params,
    route,
    connectionId,
    requestIsCurrent,
    sendReply,
    sendError,
    services,
  };
  for (const handle of [
    handleBridgeRpc,
    handleConnectionsRpc,
    handleWorldRpc,
  ]) {
    const result = handle(rpc);
    if (result !== false && (await result) !== false) return;
  }
  if (route.scope === "bridge") {
    sendError(
      "unknown-bridge-method",
      new Error(`unknown bridge-global method: ${method}`),
    );
    return null;
  }
  const connection = route.runtime;
  if (
    connection.remotePlatform === "windows" &&
    /^(?:file\.|git\.|worktree\.|agent_history\.|agent_session\.|settings\.(?:workspace_auto_sync|worktree_hooks)\.)/.test(
      method,
    )
  ) {
    sendError(
      "unsupported-windows-operation",
      new Error(unixOnlyMessage("This operation")),
    );
    return;
  }
  const { sshHost, herdr, worktreeParents, handleSettingsRpc, terminalBridge } =
    connection;

  const { enrichWorkspacesWithGitStatus } = connection.status;

  if (
    method === "workspace.path" ||
    (method === "workspace.create" && params?.cwd != null && params.cwd !== "")
  ) {
    try {
      const info = await inspectWorkspacePath(
        method === "workspace.path" ? params?.path : params?.cwd,
        { host: sshHost(), remotePlatform: connection.remotePlatform },
        method === "workspace.path",
      );
      if (method === "workspace.path") {
        sendReply({ id, result: info }, method);
        return;
      }
      if (info.error) throw new Error(`${info.error} ${info.path}`);
      if (!requestIsCurrent())
        throw new Error("Creation connection changed. Reconnect and retry.");
      params = { ...params, cwd: info.path };
    } catch (error) {
      sendError(`${method}-error`, error);
      return;
    }
  }

  if (
    (method === "tab.create" || method === "workspace.create") &&
    params &&
    Object.hasOwn(params, "browser_source")
  ) {
    try {
      const result = await terminalBridge.createFromTerminal(
        ws,
        method,
        params,
        requestIsCurrent,
        async () => {
          if (
            method === "workspace.create" &&
            params?.cwd != null &&
            params.cwd !== ""
          ) {
            const info = await inspectWorkspacePath(
              params.cwd,
              { host: sshHost(), remotePlatform: connection.remotePlatform },
              false,
            );
            if (info.error) throw new Error(`${info.error} ${info.path}`);
          }
        },
      );
      sendReply({ id, result }, method);
    } catch (error) {
      sendError(`${method}-error`, error);
    }
    return;
  }

  const connectionRpc: ConnectionRpcContext = {
    ...rpc,
    route,
    params,
    connection,
  };
  for (const handle of [
    handleLauncherRpc,
    handleBoardTownRpc,
    handleAgentRpc,
    handleFilesRpc,
    handleGitRpc,
  ]) {
    const result = handle(connectionRpc);
    if (result !== false && (await result) !== false) return;
  }
  if (method.startsWith("terminal.")) {
    return terminalBridge.handleTerminalRpc(
      ws,
      id,
      method,
      params ?? {},
      requestIsCurrent,
    );
  }
  if (method.startsWith("settings.")) {
    return handleSettingsRpc(ws, id, method, params ?? {}, requestIsCurrent);
  }
  try {
    const rawResult = await herdr.call(method, params ?? {});
    let result = rawResult;
    if (
      method === "integration.list" &&
      connection.remotePlatform !== "windows"
    ) {
      result = await enrichIntegrationVersions(result, {
        sshHost: sshHost(),
        ping: () => herdr.ping(),
      });
    }
    if (method === "workspace.list") {
      if (connection.remotePlatform !== "windows") {
        result = await worktreeParents.enrichWorkspaceList(result);
        result = await enrichWorkspacesWithGitStatus(result);
      }
      result = {
        ...result,
        navigation_mode: await terminalBridge.navigationMode(),
        tab_move_supported: await terminalBridge.tabMoveSupported(),
        endpoint_availability: terminalBridge.endpointAvailability(),
      };
    }
    // Town reads a room's order with tab.list before reordering, and refuses
    // plainly where this Herdr has no tab.move.
    if (method === "tab.list")
      result = {
        ...result,
        tab_move_supported: await terminalBridge.tabMoveSupported(),
      };
    sendReply({ id, result }, method);
  } catch (e) {
    sendError(`${method}-error`, e);
  }
}
