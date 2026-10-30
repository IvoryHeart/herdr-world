import type { ServerWebSocket } from "bun";
import {
  sendWebSocketMessage,
  WebSocketCleanupTracker,
} from "../bridge/websocket-send";
import { sanitizeConnectionError } from "../connections/manager";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import type { Logger } from "../utils/logger";
import { rpcLogLevel, shouldLogRpc } from "../utils/rpc-logging";
import type { Clock } from "./ports";

type Socket = ServerWebSocket<unknown>;

interface WebSocketCleanupSnapshot {
  client: string;
  viewedTerminals: string[];
}

/** One bounded, control-free log field. */
export function logDetail(value: string): string {
  return sanitizeConnectionError(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "?")
    .trim()
    .slice(0, 300);
}

/** The browsers connected to one service: labels, sends, cleanup, RPC logs. */
export function createBrowserClients(deps: {
  logger: Logger;
  clock: Clock;
  /** Every current connection runtime, for terminal views and counts. */
  forEachRuntime(visit: (runtime: LegacyConnectionRuntime) => void): void;
  closed?(socket: Socket): void;
  countChanged?(): void;
}) {
  const { logger } = deps;
  const clients = new Set<Socket>();
  const clientIds = new WeakMap<Socket, number>();
  const clientSessions = new WeakMap<Socket, string | null>();
  let nextClientId = 1;
  let lastClientCount = 0;

  // Conversation watchers each browser registered with, for cleanup on close.
  const conversationWatchers = new WeakMap<
    Socket,
    Set<{ unwatch(owner: object): void }>
  >();

  const rpcOutcomes = new Map<string, { status: "error"; detail?: string }>();

  function clientLabel(ws: Socket): string {
    const id = clientIds.get(ws);
    return id ? `c${id}` : "unknown";
  }

  function assignClientId(ws: Socket): string {
    clientIds.set(ws, nextClientId++);
    return clientLabel(ws);
  }

  function rpcOutcomeKey(ws: Socket, id: string) {
    return `${clientLabel(ws)}\0${id}`;
  }

  function markRpcError(
    ws: Socket,
    id: string | null | undefined,
    detail?: string,
  ) {
    if (!id) return;
    rpcOutcomes.set(rpcOutcomeKey(ws, id), { status: "error", detail });
  }

  function takeRpcOutcome(ws: Socket, id: string | null) {
    if (!id) return null;
    const key = rpcOutcomeKey(ws, id);
    const outcome = rpcOutcomes.get(key) ?? null;
    rpcOutcomes.delete(key);
    return outcome;
  }

  /** `startedAt` is `clock.monotonic()` when the request arrived. */
  function logRpc(
    ws: Socket,
    method: string | null,
    startedAt: number,
    status: "ok" | "error",
    connectionId: string | null,
    detail?: string,
  ) {
    const elapsedMs = Math.round(deps.clock.monotonic() - startedAt);
    const failed = status === "error";
    if (!shouldLogRpc(method, elapsedMs, failed)) return;
    const level = rpcLogLevel({ method, status, detail });
    logger[level]("rpc completed", {
      status,
      client: clientLabel(ws),
      method: method ? logDetail(method) : "unknown",
      connection: connectionId ? logDetail(connectionId) : undefined,
      duration_ms: elapsedMs,
      detail: detail ? logDetail(detail) : undefined,
    });
  }

  function notifyBrowserClientCount() {
    if (lastClientCount !== clients.size) {
      lastClientCount = clients.size;
      deps.countChanged?.();
    }
    deps.forEachRuntime((runtime) => {
      runtime.terminalBridge.browserClientCountChanged(clients.size);
    });
  }

  const webSocketCleanup = new WebSocketCleanupTracker<
    Socket,
    WebSocketCleanupSnapshot
  >((ws) => {
    const viewedTerminals: string[] = [];
    deps.forEachRuntime((runtime) => {
      viewedTerminals.push(...runtime.terminalBridge.viewedTerminals(ws));
      runtime.terminalBridge.cleanupWs(ws);
    });
    const snapshot = {
      client: clientLabel(ws),
      viewedTerminals,
    };
    clients.delete(ws);
    deps.closed?.(ws);
    notifyBrowserClientCount();
    return snapshot;
  });

  function safeSend(
    ws: Socket,
    payload: string,
    context = "message",
    coalesceKey?: string,
  ): boolean {
    return sendWebSocketMessage(ws, payload, {
      cleanup: () => {
        webSocketCleanup.cleanup(ws);
      },
      coalesceKey,
      context,
      warn: (message) =>
        logger.warn("websocket send failed", {
          detail: message.replace(/^\[bridge\] /, ""),
        }),
    });
  }

  /** Send one line to every connected page. */
  function broadcast(payload: string, context?: string, coalesceKey?: string) {
    for (const ws of clients) safeSend(ws, payload, context, coalesceKey);
  }

  return {
    clients,
    clientSessions,
    conversationWatchers,
    clientLabel,
    assignClientId,
    markRpcError,
    takeRpcOutcome,
    logRpc,
    notifyBrowserClientCount,
    webSocketCleanup,
    safeSend,
    broadcast,
  };
}

export type BrowserClients = ReturnType<typeof createBrowserClients>;
