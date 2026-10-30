import type { Server, ServerWebSocket } from "bun";
import { productionAdapterDescriptors } from "../adapters/registry";
import { isHtmlPath } from "../../../shared/filePreview";
import {
  flushCoalescedMessages,
  WS_PER_MESSAGE_DEFLATE,
} from "../bridge/websocket-send";
import type { WorldSnapshotAdmission } from "../bridge/world-snapshot-admission";
import type { GuiSettingsStore } from "../config/gui-settings";
import type { ServerConfig } from "../config/server-config";
import {
  connectionRoutingErrorResponse,
  type ParsedConnectionHttpRoute,
  parseConnectionHttpRoute,
  publishConnectionHttpResponse,
  rawRequestPathname,
  resolveConnectionHttpRoute,
} from "../connections/http-routing";
import type { ConnectionManager } from "../connections/manager";
import {
  ConnectionRoutingError,
  type createLegacyRoutingLogger,
  isBridgeGlobalMethod,
  serializeConnectionEnvelope,
  validateConnectionId,
} from "../connections/protocol";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import {
  type createAuthHandlers,
  unauthenticatedLoginRedirect,
} from "../http/auth";
import { browserRequestAdmissionError } from "../http/browser-admission";
import type { createHerdrSetupHandlers } from "../http/herdr-setup";
import { handleInstanceSettings } from "../http/instance-settings";
import { parseRpcMeta } from "../http/rpc-meta";
import { serveStatic } from "../http/static-files";
import {
  TERMINAL_UPLOAD_TIMEOUT_MS,
  terminalUploadRequestBodyLimit,
} from "../http/terminal-upload";
import {
  type createUpdateHandlers,
  UPDATE_HTTP_IDLE_TIMEOUT_SECONDS,
} from "../http/update";
import { workspaceFileParams } from "../http/workspace-file-params";
import {
  WORLD_CLI_IDLE_TIMEOUT_SECONDS,
  WORLD_CLI_PATH,
} from "../http/world-cli-endpoint";
import type { createWebPushService } from "../notifications/web-push";
import type { createSourcesHttpHandler } from "../sources/http";
import type { Logger } from "../utils/logger";
import { DOWNLOAD_TIMEOUT_MS } from "../workspace/file-constants";
import { canRevealFiles } from "../workspace/file-manager";
import type { createOfficeObservabilityHttpHandler } from "../world/observability-http";
import type { createWorldCliService } from "../world/world-cli-service";
import type { BrowserClients } from "./clients";
import type { Clock } from "./ports";

/** What the HTTP and WebSocket listener uses from its service. */
export type ListenerDeps = {
  config: ServerConfig;
  clock: Clock;
  logger: Logger;
  auth: ReturnType<typeof createAuthHandlers>;
  browsers: BrowserClients;
  connectionManager: ConnectionManager<LegacyConnectionRuntime>;
  legacyRoutingLogger: ReturnType<typeof createLegacyRoutingLogger>;
  snapshotAdmission: WorldSnapshotAdmission;
  handleRpc(ws: ServerWebSocket<unknown>, raw: string): Promise<unknown>;
  webPush: ReturnType<typeof createWebPushService>;
  worldCli: ReturnType<typeof createWorldCliService>;
  settings: GuiSettingsStore;
  update: ReturnType<typeof createUpdateHandlers>;
  herdrSetup: ReturnType<typeof createHerdrSetupHandlers>;
  officeObservability: ReturnType<typeof createOfficeObservabilityHttpHandler>;
  sources: ReturnType<typeof createSourcesHttpHandler>;
  /** Counts a request or message as in flight until it settles. */
  track<T>(work: Promise<T>): Promise<T>;
  /** True once the service is stopping: nothing new is admitted. */
  stopping(): boolean;
};

/** Bind the service's one origin: login, HTTP routes and the browser socket. */
export function listen(deps: ListenerDeps) {
  const {
    config,
    clock,
    logger,
    browsers,
    connectionManager,
    legacyRoutingLogger,
    snapshotAdmission,
    handleRpc,
    webPush,
    worldCli,
    settings,
    track,
    stopping,
  } = deps;
  const {
    clients,
    clientSessions,
    conversationWatchers,
    webSocketCleanup,
    safeSend,
    assignClientId,
    notifyBrowserClientCount,
    takeRpcOutcome,
    logRpc,
  } = browsers;
  const {
    isAuthed,
    sessionToken,
    handleTokenLogin,
    handleLogin,
    handlePinLogin,
    handleLogout,
    loginPage,
    bearerAuth,
  } = deps.auth;
  const { handleUpdateCheck, handleUpdateInstall } = deps.update;
  const {
    handleHerdrStatus,
    handleHerdrSetup,
    handleHerdrUpgrade,
    handleHerdrUpgradeStatus,
  } = deps.herdrSetup;
  const handleOfficeObservability = deps.officeObservability;
  const handleWorldSources = deps.sources;

  async function handleConnectionHttpRequest(
    route: ParsedConnectionHttpRoute,
    url: URL,
    req: Request,
  ): Promise<Response> {
    if (route.kind === "error") {
      return connectionRoutingErrorResponse(route.error);
    }

    let resolved: ReturnType<
      typeof resolveConnectionHttpRoute<LegacyConnectionRuntime>
    >;
    const generationText = url.searchParams.get("connection_generation");
    const requestedGeneration =
      generationText === null
        ? undefined
        : /^(0|[1-9]\d*)$/.test(generationText)
          ? Number(generationText)
          : generationText;
    try {
      resolved = resolveConnectionHttpRoute({
        route,
        requestedGeneration,
        registry: connectionManager,
        legacyLogger: legacyRoutingLogger,
      });
    } catch (error) {
      if (error instanceof ConnectionRoutingError) {
        return connectionRoutingErrorResponse(error);
      }
      return Response.json(
        { error: "connection routing failed" },
        { status: 500 },
      );
    }

    const { runtime: connection, endpoint } = resolved;
    if (connection.remotePlatform === "windows" && endpoint !== "herdr-info") {
      return publishConnectionHttpResponse(
        resolved,
        Response.json(
          {
            error:
              "Remote file transfers and agent history require a Unix SSH host.",
          },
          { status: 501 },
        ),
      );
    }
    try {
      let response: Response;
      if (endpoint === "herdr-info") {
        response = await connection.handleHerdrInfo();
      } else if (endpoint === "upload-image") {
        response = await connection.handleImageUpload(req);
      } else if (endpoint === "terminal-upload") {
        response = await connection.handleTerminalUpload(
          req,
          url.searchParams.get("filename"),
          resolved.isCurrent,
        );
      } else if (endpoint === "agent-session-download") {
        response = await connection.agentSessions.downloadFile({
          pane_id: url.searchParams.get("pane_id"),
          agent: url.searchParams.get("agent"),
          expected_session: url.searchParams.get("expected_session"),
        });
      } else if (endpoint === "agent-session-atif") {
        response = await connection.agentSessions.downloadAtif({
          pane_id: url.searchParams.get("pane_id"),
          agent: url.searchParams.get("agent"),
          expected_session: url.searchParams.get("expected_session"),
        });
      } else if (endpoint === "file-download") {
        try {
          response = await connection.files.downloadWorkspaceFile({
            ...workspaceFileParams(url),
            range: req.headers.get("range") ?? undefined,
            if_range: req.headers.get("if-range") ?? undefined,
          });
        } catch (error) {
          response = new Response((error as Error).message, { status: 400 });
        }
      } else if (endpoint === "file-upload") {
        try {
          const result = await connection.files.uploadWorkspaceFile(
            workspaceFileParams(url),
            req,
          );
          response = Response.json(result);
        } catch (error) {
          response = Response.json(
            { error: (error as Error).message },
            { status: 400 },
          );
        }
      } else {
        try {
          const result = await connection.files.deleteWorkspaceFile(
            workspaceFileParams(url),
          );
          response = Response.json(result);
        } catch (error) {
          response = Response.json(
            { error: (error as Error).message },
            { status: 400 },
          );
        }
      }
      return publishConnectionHttpResponse(resolved, response);
    } catch (error) {
      return publishConnectionHttpResponse(
        resolved,
        Response.json({ error: (error as Error).message }, { status: 500 }),
      );
    }
  }

  async function respond(
    req: Request,
    server: Server<{ sessionToken: string | null }>,
  ): Promise<Response | undefined> {
    const requestPathname = rawRequestPathname(req.url);
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      return new Response("invalid request URL", { status: 400 });
    }

    // Forwarded headers are untrusted; use the actual TCP peer address.
    const clientIp = server.requestIP(req)?.address ?? "unknown";
    const tokenLoginResponse = handleTokenLogin(req, clientIp);
    if (tokenLoginResponse) return tokenLoginResponse;

    if (url.pathname === "/health" || url.pathname === "/healthz") {
      return new Response("Ok", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    // Auth endpoints are always reachable.
    if (url.pathname === "/api/login/pin" && req.method === "POST") {
      return handlePinLogin(req, clientIp);
    }
    if (url.pathname === "/api/login" && req.method === "POST") {
      return handleLogin(req, clientIp);
    }
    if (url.pathname === "/login") {
      return loginPage();
    }
    // The login page's logo and favicon must also work before login.
    if (url.pathname === "/herdr-world-icon-192.png") {
      return serveStatic(req, config.publicDir);
    }
    if (url.pathname === "/api/logout") {
      const response = handleLogout(req);
      const token = sessionToken(req);
      if (response.ok && config.authRequired && token) {
        try {
          webPush.revokeSession(token);
        } catch (error) {
          logger.warn("Web Push logout revocation failed", {
            error: (error as Error).message,
          });
          return new Response("Unable to revoke push notifications", {
            status: 503,
            headers: { "cache-control": "no-store" },
          });
        }
        for (const client of clients) {
          if (clientSessions.get(client) !== token) continue;
          webSocketCleanup.cleanup(client);
          client.close(4001, "Logged out");
        }
      }
      return response;
    }

    if (url.pathname === WORLD_CLI_PATH) {
      // `ask --wait` holds a call for up to 20 s; Bun's default idle
      // timeout (10 s) would cut it.
      server.timeout(req, WORLD_CLI_IDLE_TIMEOUT_SECONDS);
      return worldCli.http(
        req,
        server.requestIP(req),
        server.port ?? config.port,
        bearerAuth,
      );
    }

    // Loopback listeners retain World's trusted local access policy.
    if (!isAuthed(req)) {
      const accept = req.headers.get("accept") ?? "";
      if (req.method === "GET" && accept.includes("text/html")) {
        return unauthenticatedLoginRedirect();
      }
      return new Response("unauthorized", { status: 401 });
    }

    const admissionError = browserRequestAdmissionError(
      req,
      config.host,
      config.publicOrigin,
    );
    if (admissionError) return admissionError;

    if (url.pathname === "/api/notifications/push") {
      return webPush.handle(req, sessionToken(req));
    }

    if (url.pathname === "/ws") {
      if (server.upgrade(req, { data: { sessionToken: sessionToken(req) } }))
        return undefined;
      return new Response("websocket upgrade failed", { status: 400 });
    }
    if (url.pathname === "/api/instance-settings")
      return handleInstanceSettings(req, settings);
    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        version: config.appVersion,
        socket: config.socketPath,
        auth_required: config.authRequired,
      });
    }
    if (url.pathname === "/api/update/check" && req.method === "GET") {
      server.timeout(req, UPDATE_HTTP_IDLE_TIMEOUT_SECONDS);
      return handleUpdateCheck(req);
    }
    if (url.pathname === "/api/update/install" && req.method === "POST") {
      // Binary download and verification can exceed Bun's default ten-second
      // request timeout. Keep the larger budget scoped to update requests.
      server.timeout(req, UPDATE_HTTP_IDLE_TIMEOUT_SECONDS);
      return handleUpdateInstall(req);
    }
    if (url.pathname === "/api/herdr/status" && req.method === "GET") {
      return handleHerdrStatus();
    }
    if (url.pathname === "/api/herdr/setup" && req.method === "POST") {
      // Herdr download plus service start shares the update budget.
      server.timeout(req, UPDATE_HTTP_IDLE_TIMEOUT_SECONDS);
      return handleHerdrSetup(req);
    }
    if (url.pathname === "/api/herdr/upgrade") {
      if (req.method === "POST") return handleHerdrUpgrade(req);
      if (req.method === "GET") return handleHerdrUpgradeStatus();
    }
    const officeObservabilityResponse = await handleOfficeObservability(
      req,
      url.pathname,
    );
    if (officeObservabilityResponse) return officeObservabilityResponse;
    const sourcesResponse = await handleWorldSources(req, url.pathname);
    if (sourcesResponse) return sourcesResponse;
    const connectionRoute = parseConnectionHttpRoute(
      requestPathname,
      req.method,
    );
    if (connectionRoute) {
      if (
        connectionRoute.kind === "connection" &&
        connectionRoute.endpoint === "terminal-upload"
      ) {
        server.timeout(req, TERMINAL_UPLOAD_TIMEOUT_MS / 1000);
      }
      if (
        connectionRoute.kind === "connection" &&
        connectionRoute.endpoint === "file-download" &&
        url.searchParams.get("inline") === "1" &&
        isHtmlPath(url.searchParams.get("path") ?? "")
      ) {
        // HTML preparation can require several bounded SSH resource reads.
        server.timeout(req, DOWNLOAD_TIMEOUT_MS / 1000);
      }
      return handleConnectionHttpRequest(connectionRoute, url, req);
    }
    // Everything else: serve the built frontend (embedded or on-disk).
    return serveStatic(
      req,
      config.publicDir,
      (await settings.read()).title_suffix,
    );
  }

  return Bun.serve<{ sessionToken: string | null }>({
    port: config.port,
    hostname: config.host,
    tls: config.tls,
    maxRequestBodySize: terminalUploadRequestBodyLimit(),
    fetch: (req, server) =>
      stopping()
        ? new Response("World is stopping", {
            status: 503,
            headers: { "cache-control": "no-store", "retry-after": "1" },
          })
        : track(respond(req, server)),
    websocket: {
      perMessageDeflate: WS_PER_MESSAGE_DEFLATE,
      open(ws) {
        clients.add(ws);
        clientSessions.set(ws, ws.data.sessionToken);
        const label = assignClientId(ws);
        logger.debug("client connected", {
          client: label,
          clients: clients.size,
        });
        notifyBrowserClientCount();
        safeSend(
          ws,
          JSON.stringify({
            hello: true,
            socket: config.socketPath,
            bridge_protocol_version: 2,
            default_connection_id: connectionManager.defaultId(),
            adapters: productionAdapterDescriptors(),
            capabilities: {
              connection_id: true,
              connection_scoped_http: true,
              file_reveal: canRevealFiles(ws.remoteAddress),
              connection_runtime_generation: true,
              world_snapshot_chunks: true,
              world_snapshot_chunk_admission: true,
              world_snapshot: true,
              embedded_assistant: true,
              herdr_task_notifications:
                config.taskNotificationSource === "herdr",
            },
          }),
          "hello",
        );
      },
      drain(ws) {
        // The viewer caught up: send the newest repaint we held back.
        flushCoalescedMessages(ws, {
          cleanup: () => {
            webSocketCleanup.cleanup(ws);
          },
          warn: (detail) =>
            logger.warn("websocket send failed", {
              detail: detail.replace(/^\[bridge\] /, ""),
            }),
        });
      },
      message(ws, message) {
        if (!clients.has(ws) || stopping()) return;
        const text = typeof message === "string" ? message : message.toString();
        const { id, method, connectionId, connectionGeneration } =
          parseRpcMeta(text);
        const startedAt = clock.monotonic();
        let responseConnectionId: string | null = null;
        let logConnectionId: string | null = null;
        if (method && !isBridgeGlobalMethod(method)) {
          if (connectionId === undefined) {
            responseConnectionId = connectionManager.defaultId();
            logConnectionId = responseConnectionId;
          } else {
            try {
              responseConnectionId = validateConnectionId(connectionId);
              logConnectionId = responseConnectionId;
            } catch {
              logConnectionId = "invalid";
            }
          }
        }
        void track(
          handleRpc(ws, text)
            .then(() => {
              const outcome = takeRpcOutcome(ws, id);
              logRpc(
                ws,
                method,
                startedAt,
                outcome?.status ?? "ok",
                logConnectionId,
                outcome?.detail,
              );
            })
            .catch((e) => {
              logRpc(
                ws,
                method,
                startedAt,
                "error",
                logConnectionId,
                (e as Error).message,
              );
              const errorMessage: Record<string, unknown> = {
                error: { message: (e as Error).message },
              };
              if (id) errorMessage.id = id;
              safeSend(
                ws,
                responseConnectionId
                  ? serializeConnectionEnvelope(
                      responseConnectionId,
                      errorMessage,
                      typeof connectionGeneration === "number"
                        ? connectionGeneration
                        : undefined,
                    )
                  : JSON.stringify(errorMessage),
                "message-error",
              );
            }),
        );
      },
      close(ws) {
        snapshotAdmission.retire(ws);
        for (const watcher of conversationWatchers.get(ws) ?? [])
          watcher.unwatch(ws);
        conversationWatchers.delete(ws);
        const { client, viewedTerminals } = webSocketCleanup.complete(ws);
        logger.debug("client disconnected", {
          client,
          clients: clients.size,
          terminals: viewedTerminals.length
            ? viewedTerminals.join(",")
            : "none",
        });
      },
    },
  });
}
