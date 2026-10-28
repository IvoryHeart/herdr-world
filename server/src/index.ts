import { serializeWorldInvalidation } from "./world/invalidation";
import { workspaceFileParams } from "./http/workspace-file-params";
import type { BridgeRpcContext, ConnectionRpcContext } from "./rpc/context";
import { handleAgentRpc } from "./rpc/agent";
import { handleBoardTownRpc } from "./rpc/board-town";
import { handleBridgeRpc } from "./rpc/bridge";
import { handleConnectionsRpc } from "./rpc/connections";
import { handleFilesRpc } from "./rpc/files";
import { handleGitRpc } from "./rpc/git";
import { handleLauncherRpc } from "./rpc/launcher";
import { handleWorldRpc } from "./rpc/world";

import { runPluginCommand } from "./config/plugin-command";
import { createMoveQueue } from "./world/desk-move";

/** Town moves run one at a time per connection (see world/desk-move). */
const townMoveQueues = new Map<string, ReturnType<typeof createMoveQueue>>();
import { unixOnlyMessage } from "./connections/unix-only";
import { inspectWorkspacePath } from "./workspace/path";
import { createWorkspaceWorktree } from "./worktree/create";
import { canRevealFiles } from "./workspace/file-manager";
import { WorldSnapshotAdmission } from "./bridge/world-snapshot-admission";
import { loadOrCreateSessionSecret } from "./config/session-secret";
import {
  authTokenPrintCommand,
  isShortAuthPassword,
  RECOMMENDED_PASSWORD_LENGTH,
} from "./config/auth-token";
import type { ServerWebSocket } from "bun";
import { createAssistantContext } from "./assistant/context";
import { isHtmlPath } from "../../shared/filePreview";
import { rmSync } from "node:fs";
import packageJson from "../../package.json";
import { currentBuildVersion } from "../../scripts/build-version";
import type { SshTunnelConfig } from "./bridge/ssh-tunnel";
import {
  flushCoalescedMessages,
  sendWebSocketMessage,
  WebSocketCleanupTracker,
  WS_PER_MESSAGE_DEFLATE,
} from "./bridge/websocket-send";
import {
  browserUrlFor,
  getLanIPs,
  isAnyHost,
  loadServerConfig,
  openBrowser,
  withLoginToken,
} from "./config/server-config";
import { readGuiSettings, updateGuiSettings } from "./config/gui-settings";
import { cliCommands, runCli, topLevelHelp } from "./cli";
import { CONTINUE_TO_SERVER, defaultCliContext } from "./cli/command";
import { runTaskSummaryCommand } from "./herdr/task-summary";
import {
  WORLD_CLI_IDLE_TIMEOUT_SECONDS,
  WORLD_CLI_PATH,
} from "./http/world-cli-endpoint";
import { createWorldCliService } from "./world/world-cli-service";
import { parseRpcMeta } from "./http/rpc-meta";
import { runAgentCheckoutCommand } from "./herdr/agent-checkout";
import { createWebPushService } from "./notifications/web-push";
import { enrichIntegrationVersions } from "./herdr/integration-versions";
import {
  createHerdrSetupHandlers,
  herdrSetupGuardForProfile,
} from "./http/herdr-setup";
import { HerdrClient } from "./bridge/herdr-client";
import {
  connectionRoutingErrorResponse,
  type ParsedConnectionHttpRoute,
  parseConnectionHttpRoute,
  publishConnectionHttpResponse,
  rawRequestPathname,
  resolveConnectionHttpRoute,
} from "./connections/http-routing";
import {
  ConnectionManager,
  type ConnectionRuntimeContext,
  sanitizeConnectionError,
} from "./connections/manager";
import {
  ConnectionProfileService,
  connectionIdentityForProfile,
  loadConnectionProfileBootstrap,
  type StartupLocalProfile,
  testConnectionSockets,
} from "./connections/profile-service";
import {
  type ConnectionProfile,
  ConnectionProfileStore,
  connectionRecoveryFingerprint,
} from "./connections/profiles";
import { createSshProfileRuntimeConfig } from "./connections/ssh-profile-runtime";
import {
  ConnectionRoutingError,
  createConnectionReplyPublisher,
  createLegacyRoutingLogger,
  isBridgeGlobalMethod,
  resolveReadyConnection,
  serializeConnectionEnvelope,
  serializeHerdrEventEnvelope,
  validateConnectionGeneration,
  validateConnectionId,
} from "./connections/protocol";
import {
  type ConnectionRpcRequest,
  isConnectionRpcEnvelope,
  resolveRpcRoute,
} from "./connections/rpc-routing";
import {
  createLegacyConnectionRuntime,
  type LegacyConnectionRuntime,
} from "./connections/runtime";
import { createShutdownController } from "./connections/shutdown";
import {
  bindListenerBeforeConnectionStart,
  describeListenerStartError,
} from "./connections/startup";
import { STARTUP_DEFAULT_CONNECTION_ID } from "./connections/types";
import { createAuthHandlers, unauthenticatedLoginRedirect } from "./http/auth";
import { browserRequestAdmissionError } from "./http/browser-admission";
import { serveStatic } from "./http/static-files";
import { handleInstanceSettings } from "./http/instance-settings";

import {
  TERMINAL_UPLOAD_TIMEOUT_MS,
  terminalUploadRequestBodyLimit,
} from "./http/terminal-upload";
import {
  createUpdateHandlers,
  UPDATE_HTTP_IDLE_TIMEOUT_SECONDS,
} from "./http/update";
import {
  configureServerLogger,
  createRecoveryReporter,
  type RecoveryReporter,
  serverLogger,
} from "./utils/logger";
import { runProcessWithCodeTimeout, shQuote } from "./utils/process-utils";
import { rpcLogLevel, shouldLogRpc } from "./utils/rpc-logging";
import { DOWNLOAD_TIMEOUT_MS } from "./workspace/file-constants";
import { WorldSnapshotService } from "./world/snapshot";
import { createWorldDeskService } from "./world/desk-service";
import { WorldWatchlistRegistry } from "./world/watchlist";
import { BoardStore, type BoardOp } from "./world/board-store";
import { afterHerdrClose } from "./world/board-closing";
import { reconcileReadyInterest } from "./world/interest-prune";
import {
  readPaneRecipient,
  recipientOps,
  type ObservedAgent,
} from "./world/board-recipient";
import { herdrEventName } from "./utils/herdr-events";
import { ProfileStore } from "./agent/profile-store";
import {
  createOfficeObservabilityHttpHandler,
  resolveOfficeObservabilityBootstrap,
  withOfficeObservabilityEndpoint,
} from "./world/observability-http";
import { OfficeObservabilityService } from "./world/observability";
import {
  createSourcesHttpHandler,
  storedSourceSettings,
  withSourceSettings,
} from "./sources/http";
import { SourcesService } from "./sources/service";
import { CheckoutResolver } from "./sources/links";
import { readSourceSecrets, writeSourceSecrets } from "./sources/secrets";

const snapshotAdmission = new WorldSnapshotAdmission();
const APP_VERSION = currentBuildVersion(
  process.env.HERDR_WORLD_BUILD_VERSION,
  packageJson.version,
);
const pluginCommandResult = await runPluginCommand(
  process.argv.slice(2),
  APP_VERSION,
);
if (pluginCommandResult !== null) process.exit(pluginCommandResult);
const taskSummaryCommandResult = await runTaskSummaryCommand(
  process.argv.slice(2),
  APP_VERSION,
);
const agentCheckoutCommandResult = await runAgentCheckoutCommand(
  process.argv.slice(2),
  APP_VERSION,
);
if (agentCheckoutCommandResult !== null)
  process.exit(agentCheckoutCommandResult);
if (taskSummaryCommandResult !== null) {
  process.exit(taskSummaryCommandResult);
}
const cliCommandList = cliCommands();
const cliResult = await runCli(
  process.argv.slice(2),
  defaultCliContext(APP_VERSION),
  cliCommandList,
);
if (cliResult === CONTINUE_TO_SERVER) {
  // `service run <env>` loaded the service environment; start the listener.
  process.argv.splice(2);
} else if (cliResult !== null) {
  process.exit(cliResult);
}
const config = loadServerConfig(APP_VERSION, {
  helpText: () => topLevelHelp(cliCommandList),
});
// Only a listener startup may rotate sessions. Management commands also read
// ServerConfig, sometimes with a different environment from the running service.
let sessionSecret = "";
if (config.authRequired) {
  try {
    sessionSecret = loadOrCreateSessionSecret([
      config.password,
      ...(config.pin ? [config.pin] : []),
    ]);
  } catch (cause) {
    console.error(
      `[bridge] FATAL: could not load the session signing secret: ${(cause as Error).message}`,
    );
    process.exit(1);
  }
}
configureServerLogger(config.logLevel);
const logger = serverLogger;
if (
  config.authRequired &&
  !config.generatedAuthToken &&
  isShortAuthPassword(config.password)
) {
  logger.warn(
    `The login password is shorter than ${RECOMMENDED_PASSWORD_LENGTH} characters. Use a longer one if this server is reachable beyond a trusted private network.`,
  );
}
if (config.authRequired && config.pin) {
  logger.warn(
    "PIN login is enabled. Use only behind a trusted private network or VPN; keep your password/token available for recovery.",
  );
}
const cpuProfile = config.profile
  ? (await import("./utils/cpu-profile")).startCpuProfile(
      config.profile,
      APP_VERSION,
      logger,
    )
  : undefined;
const webPush = createWebPushService({
  warn: (message) => logger.warn(message),
});
const officeObservabilityBootstrap = await readGuiSettings()
  .then((settings) => resolveOfficeObservabilityBootstrap(settings))
  .catch(() => {
    logger.warn("invalid Office observability configuration was disabled");
    return { endpoint: null, source: "none" as const };
  });
const officeObservability = new OfficeObservabilityService(
  officeObservabilityBootstrap,
);
const handleOfficeObservability = createOfficeObservabilityHttpHandler({
  service: officeObservability,
  persist: async (endpoint) => {
    await updateGuiSettings((settings) =>
      withOfficeObservabilityEndpoint(settings, endpoint),
    );
  },
});
const downstreamConnectionConfig = {
  socketPath: config.socketPath,
  clientSocketPath: config.clientSocketPath,
  sshHost: config.sshHost,
  session: config.session,
  hasExplicitSocketPath: config.hasExplicitSocketPath,
  hasExplicitClientSocketPath: config.hasExplicitClientSocketPath,
};
const {
  isAuthed,
  sessionToken,
  handleTokenLogin,
  handleLogin,
  handlePinLogin,
  handleLogout,
  loginPage,
  bearerAuth,
} = createAuthHandlers({
  authRequired: config.authRequired,
  password: config.password,
  pin: config.pin,
  sessionSecret,
  urlLoginToken: config.generatedAuthToken,
  tokenCommand:
    config.generatedAuthTokenPath &&
    authTokenPrintCommand(config.generatedAuthTokenPath),
  secureCookies: Boolean(config.tls),
});

type RpcRequest = ConnectionRpcRequest;

const { handleUpdateCheck, handleUpdateInstall } = createUpdateHandlers({
  appVersion: APP_VERSION,
  runProcessWithCodeTimeout,
  shQuote,
  scheduleProcessExit: scheduleManagedShutdown,
});
const clients = new Set<ServerWebSocket<unknown>>();
const clientIds = new WeakMap<ServerWebSocket<unknown>, number>();
const clientSessions = new WeakMap<ServerWebSocket<unknown>, string | null>();
interface WebSocketCleanupSnapshot {
  client: string;
  viewedTerminals: string[];
}
let nextClientId = 1;

// Conversation watchers each browser registered with, for cleanup on close.
const conversationWatchers = new WeakMap<
  ServerWebSocket<unknown>,
  Set<{ unwatch(owner: object): void }>
>();

const rpcOutcomes = new Map<string, { status: "error"; detail?: string }>();

const legacyRoutingLogger = createLegacyRoutingLogger({
  log: (message) =>
    logger.warn("deprecated request routing", { detail: message }),
});

function clientLabel(ws: ServerWebSocket<unknown>): string {
  const id = clientIds.get(ws);
  return id ? `c${id}` : "unknown";
}

function assignClientId(ws: ServerWebSocket<unknown>): string {
  clientIds.set(ws, nextClientId++);
  return clientLabel(ws);
}

function logDetail(value: string): string {
  return sanitizeConnectionError(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "?")
    .trim()
    .slice(0, 300);
}

function rpcOutcomeKey(ws: ServerWebSocket<unknown>, id: string) {
  return `${clientLabel(ws)}\0${id}`;
}

function markRpcError(
  ws: ServerWebSocket<unknown>,
  id: string | null | undefined,
  detail?: string,
) {
  if (!id) return;
  rpcOutcomes.set(rpcOutcomeKey(ws, id), { status: "error", detail });
}

function takeRpcOutcome(ws: ServerWebSocket<unknown>, id: string | null) {
  if (!id) return null;
  const key = rpcOutcomeKey(ws, id);
  const outcome = rpcOutcomes.get(key) ?? null;
  rpcOutcomes.delete(key);
  return outcome;
}

function logRpc(
  ws: ServerWebSocket<unknown>,
  method: string | null,
  startedAt: number,
  status: "ok" | "error",
  connectionId: string | null,
  detail?: string,
) {
  const elapsedMs = Date.now() - startedAt;
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

function summarizeHerdrEvent(event: any): string {
  const type = logDetail(String(event?.event ?? event?.type ?? "unknown"));
  const data = event?.data && typeof event.data === "object" ? event.data : {};
  const ids = ["workspace_id", "tab_id", "pane_id", "agent_id", "terminal_id"]
    .map((key) => {
      const value = data[key] ?? event?.[key];
      return typeof value === "string" && value
        ? `${key}=${logDetail(value)}`
        : "";
    })
    .filter(Boolean);
  return [`type=${type}`, ...ids].join(" ");
}

const connectionProfileStore = new ConnectionProfileStore();
const startupDefaultProfile: StartupLocalProfile = {
  id: STARTUP_DEFAULT_CONNECTION_ID,
  label: "Default",
  type: "local",
  control_socket_path: config.socketPath,
  client_socket_path: config.clientSocketPath,
  auto_connect: true,
};
const explicitStartupOverride = Boolean(
  config.hasExplicitSocketPath ||
    config.hasExplicitClientSocketPath ||
    config.sshHost ||
    config.session,
);
let connectionBootstrap;
try {
  connectionBootstrap = loadConnectionProfileBootstrap({
    store: connectionProfileStore,
    startupProfile: startupDefaultProfile,
    explicitStartupOverride,
  });
} catch (error) {
  const registryLoadError = sanitizeConnectionError(error);
  logger.error("invalid connection registry preserved", {
    error: registryLoadError,
    profile_mutations: "disabled",
  });
  connectionBootstrap = {
    defaultConnectionId: STARTUP_DEFAULT_CONNECTION_ID,
    explicitStartupOverride,
    persistedRegistry: null,
    registryLoadError,
    registrations: [
      { profile: startupDefaultProfile, readOnly: true as const },
    ],
  };
}

const connectionFailureReporters = new Map<string, RecoveryReporter>();
const readyConnectionGenerations = new Map<string, number>();
let worldSnapshots: WorldSnapshotService<LegacyConnectionRuntime> | null = null;
const worldWatchlist = new WorldWatchlistRegistry();
const deskService = createWorldDeskService((line) => {
  for (const ws of clients) safeSend(ws, line, "world-desk");
});
let boardStore: BoardStore | null = null;
function board() {
  boardStore ??= new BoardStore(undefined, {
    log: (message) => console.warn(message),
  });
  return boardStore;
}

let profileStore: ProfileStore | null = null;
/** Opened on first use, like Board's store. */
function profiles() {
  profileStore ??= new ProfileStore(undefined, {
    log: (message) => console.warn(message),
  });
  return profileStore;
}
function publishProfilesChanged(revision: number) {
  const line = JSON.stringify({
    control: { type: "world_profiles_changed", revision },
  });
  for (const ws of clients) safeSend(ws, line, "world-profiles");
}

/**
 * Record which agent each newly strung pane end is for: the agent the
 * browser showed, confirmed by reading the pane on its host's current
 * runtime (see recipientOps). Saving never waits for this; a string left
 * unbound makes Send ask the user which agent to send to.
 */
async function bindBoardRecipients(
  ops: readonly BoardOp[],
  observed: ReadonlyMap<string, ObservedAgent>,
) {
  const recorded = await recipientOps(
    board().get(),
    ops,
    observed,
    async (connectionId, paneId) => {
      const { runtime, isCurrent } = resolveReadyConnection(
        connectionManager,
        connectionId,
      );
      const read = await readPaneRecipient(
        (rpc, rpcParams) => runtime.herdr.call(rpc, rpcParams, 10_000),
        paneId,
      );
      return isCurrent() ? read : null;
    },
  );
  if (recorded.length) publishBoardChanged(board().patch(recorded).revision);
}

function publishBoardChanged(revision: number) {
  const line = JSON.stringify({
    control: { type: "world_board_changed", revision },
  });
  for (const ws of clients) safeSend(ws, line, "world-board");
}

/** The agent CLI (world-cli-service.ts). */
const worldCli = createWorldCliService({
  board: { get: () => board().get(), patch: (ops) => board().patch(ops) },
  connections: () => connectionManager,
  snapshots: () => worldSnapshots,
  publishBoard: publishBoardChanged,
  broadcast: (line) => {
    for (const ws of clients) safeSend(ws, line, "world-ledger");
  },
});

function publishWatchlistChanged(revision: number) {
  const line = JSON.stringify({
    control: { type: "world_watchlist_changed", revision },
  });
  for (const ws of clients) safeSend(ws, line, "world-watchlist");
}

function publishWorldInvalidation(
  connectionId: string,
  connectionGeneration: number,
  observedLate = false,
) {
  const revision = worldSnapshots?.invalidate(
    observedLate ? undefined : connectionId,
  );
  if (revision === undefined) return;
  const line = serializeWorldInvalidation(
    connectionId,
    connectionGeneration,
    revision,
    connectionManager,
  );
  for (const ws of clients) safeSend(ws, line, "world-invalidation");
}

function connectionFailureReporter(connectionId: string): RecoveryReporter {
  let reporter = connectionFailureReporters.get(connectionId);
  if (!reporter) {
    reporter = createRecoveryReporter({
      logger: logger.child("connections"),
      failureMessage: "connection degraded",
      recoveryMessage: "connection recovered",
    });
    connectionFailureReporters.set(connectionId, reporter);
  }
  return reporter;
}

const connectionManager = new ConnectionManager<LegacyConnectionRuntime>(
  connectionBootstrap.defaultConnectionId,
  (status) => {
    deskService.retire(status.id, status.generation);
    const retired = worldWatchlist.retireConnectionGeneration(
      status.id,
      status.generation,
    );
    if (retired.changed) publishWatchlistChanged(retired.revision);
    publishWorldInvalidation(status.id, status.generation);
    const fields = {
      connection: status.id,
      state: status.state,
      generation: status.generation,
    };
    logger.debug("connection status", {
      ...fields,
      error: status.error?.message,
    });
    const reporter = connectionFailureReporter(status.id);
    if (
      (status.state === "error" || status.state === "reconnecting") &&
      status.error
    ) {
      reporter.failure(status.error.message, fields);
      return;
    }
    if (status.state !== "ready") return;
    void reconcileReadyInterest(
      board(),
      connectionManager.readyRuntimeLease(status.id),
      publishBoardChanged,
    );
    resumeAssistantIfLoaded();
    if (reporter.recovered(fields)) {
      readyConnectionGenerations.set(status.id, status.generation);
    } else if (
      readyConnectionGenerations.get(status.id) !== status.generation
    ) {
      readyConnectionGenerations.set(status.id, status.generation);
      logger.info("connection ready", fields);
    }
  },
  logger.child("connections"),
);
worldSnapshots = new WorldSnapshotService(
  connectionManager,
  Date.now,
  (connectionId, generation) =>
    publishWorldInvalidation(connectionId, generation, true),
  undefined,
  () => worldWatchlist.list(),
  deskService.observe,
);

const assistantContext = createAssistantContext({
  catalog: () => connectionProfiles.list(),
  lease: (id) => connectionManager.readyRuntimeLease(id),
  recoveryFingerprint: (id) => {
    const profile = connectionProfiles
      .list()
      .find((profile) => profile.id === id);
    if (!profile) throw new Error("Ranger connection is no longer configured");
    return connectionRecoveryFingerprint(profile);
  },
  createWorktree: (runtime, params, isCurrent, beforeDispatch) =>
    createWorkspaceWorktree(
      runtime,
      params,
      isCurrent,
      undefined,
      undefined,
      beforeDispatch,
    ),
});
let assistantServiceTask: Promise<
  Awaited<
    ReturnType<typeof import("./assistant/service").createAssistantService>
  >
> | null = null;
function getAssistantService() {
  assistantServiceTask ??= import("./assistant/service")
    .then(({ createAssistantService }) =>
      createAssistantService({
        context: assistantContext,
        publish: (snapshot) => {
          const payload = JSON.stringify({ assistant: snapshot });
          for (const ws of clients)
            safeSend(ws, payload, "assistant", "assistant");
        },
        notify: (notification) => {
          const payload = JSON.stringify({
            assistant_notification: notification,
          });
          for (const ws of clients)
            safeSend(ws, payload, "assistant_notification");
          webPush.notify(notification, () => true);
        },
      }),
    )
    .catch((error) => {
      assistantServiceTask = null;
      throw error;
    });
  return assistantServiceTask;
}

function resumeAssistantIfLoaded() {
  void assistantServiceTask
    ?.then((service) => service.resume())
    .catch(() => {
      logger.warn("Ranger recovery could not be started");
    });
}

function defaultConnectionProfile() {
  return connectionProfiles
    .list()
    .find((profile) => profile.id === connectionManager.defaultId());
}

const {
  handleHerdrStatus,
  handleHerdrSetup,
  handleHerdrUpgrade,
  handleHerdrUpgradeStatus,
} = createHerdrSetupHandlers({
  ping: () => {
    const runtime = connectionManager.defaultReadyRuntime();
    return runtime
      ? runtime.herdr.ping()
      : new HerdrClient(config.socketPath).ping();
  },
  guard: () => herdrSetupGuardForProfile(config, defaultConnectionProfile()),
  upgrade: {
    worldVersion: APP_VERSION,
    server: () => {
      const profile = defaultConnectionProfile();
      if (profile?.type !== "local") return undefined;
      const client = () => new HerdrClient(profile.control_socket_path);
      return {
        socketPath: profile.control_socket_path,
        ping: () => client().ping(),
        call: (method, params, timeoutMs) =>
          client().call(method, params, timeoutMs),
      };
    },
  },
});

function runtimeFactoryForProfile(
  profile: ConnectionProfile | StartupLocalProfile,
) {
  const identity = connectionIdentityForProfile(profile);
  return (context: ConnectionRuntimeContext) => {
    const profileConfig: SshTunnelConfig =
      profile.id === STARTUP_DEFAULT_CONNECTION_ID
        ? downstreamConnectionConfig
        : profile.type === "ssh"
          ? createSshProfileRuntimeConfig(profile)
          : {
              socketPath: profile.control_socket_path,
              clientSocketPath: profile.client_socket_path,
              sshHost: undefined,
              session: undefined,
              hasExplicitSocketPath: true,
              hasExplicitClientSocketPath: true,
              ownedRuntimeDirectory: undefined,
            };
    let runtime: LegacyConnectionRuntime;
    try {
      runtime = createLegacyConnectionRuntime({
        identity,
        connectionGeneration: context.generation,
        config: profileConfig,
        logger: logger.child("connection"),
        safeSend,
        broadcast: (payload, context) => {
          for (const ws of clients) safeSend(ws, payload, context);
        },
        clientLabel,
        markRpcError,
        taskNotificationSource: config.taskNotificationSource,
        onTaskEvent: (event) => {
          const connections = connectionProfiles.list();
          webPush.notify(
            {
              ...event,
              connectionId: identity.id,
              connectionLabel:
                connections.length > 1
                  ? (connections.find(
                      (connection) => connection.id === identity.id,
                    )?.label ?? identity.label)
                  : undefined,
              runtimeGeneration: context.generation,
            },
            context.isCurrent,
          );
        },
        onEvent: (event, eventIdentity) => {
          if (!context.isCurrent()) return;
          publishWorldInvalidation(eventIdentity.id, context.generation);
          afterHerdrClose(
            board(),
            eventIdentity.id,
            herdrEventName(event),
            event,
            {
              call: (rpc, rpcParams) =>
                runtime.herdr.call(rpc, rpcParams, 10_000),
              isCurrent: context.isCurrent,
              changed: publishBoardChanged,
            },
          );
          logger.debug("Herdr event", {
            connection: eventIdentity.id,
            detail: summarizeHerdrEvent(event),
          });
          try {
            const line = serializeHerdrEventEnvelope(
              eventIdentity.id,
              event,
              context.generation,
            );
            for (const ws of clients) safeSend(ws, line, "event");
          } catch (error) {
            logger.warn("dropped invalid Herdr event", {
              connection: eventIdentity.id,
              error: sanitizeConnectionError(error),
            });
          }
        },
        onTransportExit: profileConfig.sshHost
          ? (error) => {
              if (!context.isCurrent()) return;
              const reconnecting = connectionProfiles.willRetry(
                profile.id,
                error,
              );
              context.reportError(error, { reconnecting });
              connectionProfiles.runtimeFailed(profile.id, error);
            }
          : undefined,
      });
    } catch (error) {
      if (profileConfig.ownedRuntimeDirectory) {
        rmSync(profileConfig.ownedRuntimeDirectory, {
          recursive: true,
          force: true,
        });
      }
      throw error;
    }
    return {
      ...runtime,
      async startTransport() {
        await runtime.startTransport();
        await testConnectionSockets(
          profileConfig.socketPath,
          profileConfig.clientSocketPath,
        );
      },
    };
  };
}

const connectionProfiles = new ConnectionProfileService({
  manager: connectionManager,
  store: connectionProfileStore,
  bootstrap: connectionBootstrap,
  createRuntime: runtimeFactoryForProfile,
});

// Built-in sources (GitHub, Jira). On by default; each runs only while a
// browser asks and keeps its credentials in private service storage.
const runSourceProcess = async (argv: string[], timeoutMs: number) => {
  try {
    return await runProcessWithCodeTimeout(argv, timeoutMs, {
      env: {
        ...process.env,
        GH_PROMPT_DISABLED: "1",
        GIT_TERMINAL_PROMPT: "0",
        NO_COLOR: "1",
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { code: 127, stdout: "", stderr: "" };
    throw error;
  }
};
const worldSources = new SourcesService({
  settings: await readGuiSettings()
    .then(storedSourceSettings)
    .catch(() => ({})),
  persistSettings: async (sources) => {
    await updateGuiSettings((settings) =>
      withSourceSettings(settings, sources),
    );
  },
  secrets: { read: () => readSourceSecrets(), write: writeSourceSecrets },
  run: runSourceProcess,
  topology: async () =>
    worldSnapshots ? (await worldSnapshots.snapshot()).connections : [],
  resolver: new CheckoutResolver(runSourceProcess, (connectionId) => {
    if (connectionId === STARTUP_DEFAULT_CONNECTION_ID && config.sshHost)
      return { kind: "ssh", destination: config.sshHost };
    const profile = connectionProfiles
      .list()
      .find((entry) => entry.id === connectionId);
    if (profile?.type === "local") return { kind: "local" };
    if (profile?.type === "ssh" && profile.remote_platform !== "windows")
      return { kind: "ssh", destination: profile.ssh_destination };
    return null;
  }),
});
const handleWorldSources = createSourcesHttpHandler(worldSources);

function notifyBrowserClientCount() {
  connectionManager.forEachCurrentRuntime((runtime) => {
    runtime.terminalBridge.browserClientCountChanged(clients.size);
  });
}

const webSocketCleanup = new WebSocketCleanupTracker<
  ServerWebSocket<unknown>,
  WebSocketCleanupSnapshot
>((ws) => {
  const viewedTerminals: string[] = [];
  connectionManager.forEachCurrentRuntime((runtime) => {
    viewedTerminals.push(...runtime.terminalBridge.viewedTerminals(ws));
    runtime.terminalBridge.cleanupWs(ws);
  });
  const snapshot = {
    client: clientLabel(ws),
    viewedTerminals,
  };
  clients.delete(ws);
  notifyBrowserClientCount();
  return snapshot;
});

function safeSend(
  ws: ServerWebSocket<unknown>,
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

/** What the rpc/ namespace handlers share with the service. */
const rpcServices = {
  bindBoardRecipients,
  board,
  clients,
  connectionManager,
  connectionProfiles,
  conversationWatchers,
  getAssistantService,
  logger,
  markRpcError,
  profiles,
  publishBoardChanged,
  publishProfilesChanged,
  publishWatchlistChanged,
  publishWorldInvalidation,
  safeSend,
  snapshotAdmission,
  townMoveQueues,
  worldWatchlist,
  worldDesk: deskService.registry,
  publishDeskChanged: deskService.publish,
  worldCli,
  get worldSnapshots() {
    return worldSnapshots;
  },
};
export type RpcServices = typeof rpcServices;

async function handleRpc(ws: ServerWebSocket<unknown>, raw: string) {
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
    services: rpcServices,
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

function main() {
  const server = bindListenerBeforeConnectionStart({
    bindListener: () =>
      Bun.serve<{ sessionToken: string | null }>({
        port: config.port,
        hostname: config.host,
        tls: config.tls,
        maxRequestBodySize: terminalUploadRequestBodyLimit(),
        async fetch(req, server) {
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
            if (
              server.upgrade(req, { data: { sessionToken: sessionToken(req) } })
            )
              return undefined;
            return new Response("websocket upgrade failed", { status: 400 });
          }
          if (url.pathname === "/api/instance-settings")
            return handleInstanceSettings(req);
          if (url.pathname === "/api/health") {
            return Response.json({
              ok: true,
              version: APP_VERSION,
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
            (await readGuiSettings()).title_suffix,
          );
        },
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
            if (!clients.has(ws)) return;
            const text =
              typeof message === "string" ? message : message.toString();
            const { id, method, connectionId, connectionGeneration } =
              parseRpcMeta(text);
            const startedAt = Date.now();
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
              });
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
      }),
    startConnection: async () => {
      await connectionProfiles.startConfigured();
      // Resume saved work even when no browser has opened Ranger yet.
      await getAssistantService();
      resumeAssistantIfLoaded();
      notifyBrowserClientCount();
      const runtime = connectionManager.defaultReadyRuntime();
      void runtime?.herdr
        .ping()
        .then((ping) =>
          logger.info("Herdr reachable", {
            connection: runtime.identity.id,
            version: ping.version,
            protocol: ping.protocol,
          }),
        )
        .catch((error) =>
          logger.warn("Herdr not reachable yet", {
            connection: runtime.identity.id,
            error: sanitizeConnectionError(error),
            action: "run `herdr-world herdr setup`; RPCs retry per request",
          }),
        );
    },
    onConnectionError: (error) => {
      logger.warn("default connection startup failed", {
        error: sanitizeConnectionError(error),
      });
    },
  });
  const listeningPort = server.port ?? config.port;
  const publicBrowserUrl = browserUrlFor(
    config.host,
    listeningPort,
    Boolean(config.tls),
  );
  logger.info("listening", {
    url: publicBrowserUrl,
    websocket: "/ws",
    log_level: config.logLevel,
  });
  if (config.authRequired) {
    if (config.generatedAuthTokenPath) {
      logger.info("authentication required", {
        mode: "generated token",
        path: config.generatedAuthTokenPath,
      });
    } else {
      logger.info("authentication required", { mode: "password" });
    }
  }
  logger.debug("Herdr sockets configured", {
    control_socket: config.socketPath,
    client_socket: config.clientSocketPath,
    public_dir: config.publicDir,
  });
  logger.info("browser URL", { url: publicBrowserUrl });

  const browserUrl = withLoginToken(
    publicBrowserUrl,
    config.generatedAuthToken,
  );
  if (isAnyHost(config.host)) {
    const lanUrls = getLanIPs().map((ip) =>
      browserUrlFor(ip, listeningPort, Boolean(config.tls)),
    );
    if (lanUrls.length > 0) {
      for (const url of lanUrls) logger.info("LAN URL", { url });
    } else {
      logger.warn("no LAN IPv4 address detected");
    }
  }
  openBrowser(config, browserUrl);
}

let managerStopTask: Promise<void> | null = null;
function stopManagerOnce(): Promise<void> {
  connectionProfiles.stopSupervision();
  webPush.stop();
  managerStopTask ??= (async () => {
    await assistantServiceTask
      ?.then((service) => service.dispose())
      .catch(() => {});
    await Promise.all([connectionManager.stopAll(), cpuProfile?.stop()]);
  })();
  return managerStopTask;
}

const shutdownController = createShutdownController({
  stop: stopManagerOnce,
  exit: (code) => process.exit(code),
  onStopError: (error) => {
    logger.error("connection shutdown failed", {
      error: sanitizeConnectionError(error),
    });
  },
});

function scheduleManagedShutdown(): void {
  const timer = setTimeout(() => {
    void shutdownController.request(0);
  }, 1_000);
  timer.unref();
}

process.on("exit", () => {
  void stopManagerOnce();
});
process.on("SIGINT", () => {
  void shutdownController.request(130);
});
process.on("SIGTERM", () => {
  void shutdownController.request(143);
});

try {
  main();
} catch (e) {
  logger.error("fatal startup error", {
    error: describeListenerStartError(e, config.host, config.port),
  });
  void shutdownController.request(1);
}
