import { runPluginCommand } from "./config/plugin-command";
import { createMoveQueue, moveDesk, movePane } from "./world/desk-move";

/** Town moves run one at a time per connection (see world/desk-move). */
const townMoveQueues = new Map<string, ReturnType<typeof createMoveQueue>>();
import { unixOnlyMessage } from "./connections/unix-only";
import { inspectWorkspacePath } from "./workspace/path";
import { createWorkspaceWorktree } from "./worktree/create";
import { canRevealFiles } from "./workspace/file-manager";
import { sendWorldSnapshotReply } from "./bridge/world-snapshot-reply";
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
  dispatchAgentSessionLink,
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
import { rpcLogLevel } from "./utils/rpc-logging";
import { DOWNLOAD_TIMEOUT_MS } from "./workspace/file-constants";
import { WorldSnapshotService } from "./world/snapshot";
import { WorldWatchlistRegistry } from "./world/watchlist";
import {
  clientBoardOps,
  moveFollowOps,
  reconcileOps,
  tabClosedColorOps,
  BoardConflictError,
  BoardStore,
  type BoardOp,
} from "./world/board-store";
import {
  readPaneRecipient,
  recipientOps,
  type ObservedAgent,
} from "./world/board-recipient";
import { linkedNoteText, sendNote } from "./world/board-send";
import { checkAnchor } from "./world/board-anchor";
import { herdrEventName } from "./utils/herdr-events";
import { agentKinds, launchAgent } from "./agent/launch";
import { profileLaunch } from "./agent/profile-launch";
import { ProfileStore } from "./agent/profile-store";
import { discoverSkills } from "./agent/skills";
import { harnessReadiness, openHarnessLogin } from "./agent/harness-readiness";
import { tabCardKey } from "../../shared/terminalColor";
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
import {
  removeWorktreeWithRecovery,
  WORKTREE_REMOVE_TIMEOUT_MS,
} from "./worktree/remove";

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

const IMPORTANT_RPC_METHODS = new Set([
  "bridge.pause_others",
  "agent_conversation.get",
  "agent_conversation.latest",
  "agent_conversation.steps",
  "agent_conversation.send",
  "agent_conversation.dismiss",
  "agent_conversation.answer",
  "agent_conversation.watch",
  "agent_conversation.unwatch",
  "agent_history.get",
  "agent_history.entry",
  "agent_session.get",
  "agent_turn.get",
  "agent_checkout.get",
  "agent_session.link_preview",
  "agent_session.link",
  "file.read",
  "git.diff_file",
  "git.commit_file",
  "git.commit_preview",
  "git.file_action",
  "git.pull",
  "git.repo_action",
  "settings.update_repo",
  "settings.workspace_auto_sync.get",
  "settings.workspace_auto_sync.list",
  "settings.workspace_auto_sync.update",
  "settings.workspace_auto_sync.update_key",
  "settings.worktree_hooks.get",
  "worktree.create",
  "worktree.open",
  "worktree.remove",
]);
const SLOW_RPC_LOG_MS = 750;
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

function parseRpcMeta(raw: string): {
  id: string | null;
  method: string | null;
  connectionId: unknown;
  connectionGeneration: unknown;
} {
  try {
    const msg = JSON.parse(raw);
    return {
      id: typeof msg?.id === "string" ? msg.id : null,
      method: typeof msg?.method === "string" ? msg.method : null,
      connectionId: Object.hasOwn(msg ?? {}, "connection_id")
        ? msg.connection_id
        : undefined,
      connectionGeneration: Object.hasOwn(msg ?? {}, "connection_generation")
        ? msg.connection_generation
        : undefined,
    };
  } catch {
    return {
      id: null,
      method: null,
      connectionId: undefined,
      connectionGeneration: undefined,
    };
  }
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

function shouldLogRpc(
  method: string | null,
  elapsedMs: number,
  failed: boolean,
) {
  if (!method) return failed;
  if (failed) return true;
  if (method === "bridge.ping" || method === "bridge.status") return false;
  if (method === "terminal.input" || method === "terminal.scroll") return false;
  if (method === "terminal.resize" && elapsedMs < SLOW_RPC_LOG_MS) return false;
  return IMPORTANT_RPC_METHODS.has(method) || elapsedMs >= SLOW_RPC_LOG_MS;
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
let boardStore: BoardStore | null = null;
/** Opened on first use, so a World without Board never touches the file. */
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
 * A tab Herdr closed on the current runtime loses its saved colour, so colours
 * of closed tabs do not accumulate. The tab's plain key could also be an older
 * Herdr workspace's ID; it goes only once Herdr says no such workspace exists.
 */
/** The host's workspace IDs after a move, with both rooms of the move. */
async function moveWorkspaceIds(
  call: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  moved: { workspace_id: string; source_workspace_id?: string },
) {
  const ids = new Set([moved.workspace_id]);
  if (moved.source_workspace_id) ids.add(moved.source_workspace_id);
  try {
    const listed = (await call("workspace.list", {})) as {
      workspaces?: { workspace_id?: unknown }[];
    };
    for (const entry of listed?.workspaces ?? [])
      if (typeof entry.workspace_id === "string") ids.add(entry.workspace_id);
  } catch {
    // The two rooms of the move are what a colliding tab key usually needs.
  }
  return ids;
}

async function dropClosedTabColor(
  connectionId: string,
  tabId: string,
  call: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  isCurrent: () => boolean,
) {
  try {
    const colors = board().get().layout.colors;
    const plain = Boolean(colors[`${connectionId}:${tabId}`]);
    if (!plain && !colors[`${connectionId}:tab:${tabId}`]) return;
    const absent =
      plain &&
      (
        await checkAnchor(call, {
          kind: "workspace",
          native_id: tabId,
          isCurrent,
        })
      ).state === "absent";
    if (!isCurrent()) return;
    const ops = tabClosedColorOps(board().get(), connectionId, tabId, absent);
    if (ops.length) publishBoardChanged(board().patch(ops).revision);
  } catch (error) {
    logger.warn("Board could not drop a closed tab's colour", {
      detail: String(error),
    });
  }
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
  const line = JSON.stringify({
    control: {
      type: "world_invalidated",
      connection_id: connectionId,
      connection_generation: connectionGeneration,
      revision,
    },
  });
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
          const closedTab =
            herdrEventName(event)?.replaceAll("_", ".") === "tab.closed"
              ? (event as { data?: { tab_id?: unknown } }).data?.tab_id
              : undefined;
          if (typeof closedTab === "string" && closedTab)
            void dropClosedTabColor(
              eventIdentity.id,
              closedTab,
              (rpc, rpcParams) => runtime.herdr.call(rpc, rpcParams, 10_000),
              context.isCurrent,
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
  if (method === "bridge.ping") {
    sendReply({ id, result: { ok: true } }, "bridge-ping");
    return;
  }
  if (method === "bridge.status") {
    sendReply(
      {
        id,
        result: {
          clients: clients.size,
          terminals:
            connectionManager
              .defaultReadyRuntime()
              ?.terminalBridge.statusTerminals() ?? [],
          default_connection_id: connectionManager.defaultId(),
          connections: connectionProfiles.list(),
        },
      },
      "bridge-status",
    );
    return;
  }
  if (method.startsWith("bridge.assistant.")) {
    try {
      // Browser admissions must carry the selected catalogue scope. Internal
      // scheduled turns may use the service's own verified fixed scope.
      if (
        [
          "bridge.assistant.send",
          "bridge.assistant.task.create",
          "bridge.assistant.task.update",
        ].includes(method) &&
        !Array.isArray(params?.scope)
      )
        throw new Error("Invalid workspace scope");
      const result =
        method === "bridge.assistant.context"
          ? await (await getAssistantService()).workspaceCatalog()
          : method === "bridge.assistant.mentions"
            ? await (await getAssistantService()).mentionCatalog(params ?? {})
            : method === "bridge.assistant.task.get"
              ? await (await getAssistantService()).taskDetail(params ?? {})
              : await (await getAssistantService()).handle(
                  method,
                  params ?? {},
                );
      sendReply({ id, result }, "assistant-rpc");
    } catch (error) {
      sendError("assistant-rpc-error", error);
    }
    return;
  }
  if (method === "connections.list") {
    sendReply(
      {
        id,
        result: {
          default_connection_id: connectionManager.defaultId(),
          connections: connectionProfiles.list(),
        },
      },
      "connections-list",
    );
    return;
  }
  if (method === "world.snapshot") {
    let transfer: ReturnType<WorldSnapshotAdmission["open"]> | undefined;
    try {
      const snapshots = worldSnapshots;
      if (!snapshots) throw new Error("World snapshot service is unavailable");
      if (
        req.accept_world_snapshot_chunks === true &&
        req.accept_world_snapshot_chunk_admission === true
      )
        transfer = snapshotAdmission.open(ws, id);
      await sendWorldSnapshotReply(
        id,
        await snapshots.snapshot(params),
        req.accept_world_snapshot_chunks === true,
        (payload) => safeSend(ws, payload, "world-snapshot"),
        () => clients.has(ws),
        transfer?.wait,
      );
    } catch (error) {
      sendError("world-snapshot-error", error);
    } finally {
      transfer?.close();
    }
    return;
  }
  if (method === "world.board.get") {
    try {
      sendReply({ id, result: board().get() }, "world-board-get");
    } catch (error) {
      sendError("world-board-get-error", error);
    }
    return;
  }
  if (method === "world.board.patch") {
    try {
      const { ops, observed } = clientBoardOps(
        (params as { ops?: unknown } | undefined)?.ops,
      );
      const result = board().patch(ops);
      publishBoardChanged(result.revision);
      sendReply({ id, result: { document: result } }, "world-board-patch");
      void bindBoardRecipients(ops, observed).catch((error) =>
        logger.warn("Board could not record a string's agent", {
          detail: String(error),
        }),
      );
    } catch (error) {
      if (error instanceof BoardConflictError)
        sendReply(
          { id, result: { conflict: error.message, document: error.document } },
          "world-board-patch",
        );
      else sendError("world-board-patch-error", error);
    }
    return;
  }
  if (method === "world.profiles.get") {
    try {
      sendReply({ id, result: profiles().get() }, "world-profiles-get");
    } catch (error) {
      sendError("world-profiles-get-error", error);
    }
    return;
  }
  if (method === "world.profiles.save" || method === "world.profiles.delete") {
    try {
      const p = (params ?? {}) as Record<string, unknown>;
      const result =
        method === "world.profiles.save"
          ? profiles().save(p.profile)
          : profiles().delete(String(p.id ?? ""));
      publishProfilesChanged(result.revision);
      sendReply({ id, result }, "world-profiles-write");
    } catch (error) {
      sendError("world-profiles-write-error", error);
    }
    return;
  }
  if (method === "world.watchlist.list") {
    sendReply({ id, result: worldWatchlist.list() }, "world-watchlist-list");
    return;
  }
  if (method === "world.watchlist.pin" || method === "world.watchlist.unpin") {
    try {
      const identity = params as Record<string, unknown> | undefined;
      const connectionId = identity?.connection_id;
      const generation = identity?.connection_generation;
      const terminalId = identity?.terminal_id;
      if (
        typeof connectionId !== "string" ||
        !connectionId ||
        !Number.isSafeInteger(generation) ||
        (generation as number) < 0 ||
        typeof terminalId !== "string" ||
        !terminalId
      ) {
        throw new Error("invalid World watch identity");
      }
      if (method === "world.watchlist.unpin") {
        const result = worldWatchlist.unpin({
          connection_id: connectionId,
          connection_generation: generation as number,
          terminal_id: terminalId,
        });
        if (result.changed) {
          publishWorldInvalidation(connectionId, generation as number);
          publishWatchlistChanged(result.revision);
        }
        sendReply(
          { id, result: { ...worldWatchlist.list(), changed: result.changed } },
          "world-watchlist-unpin",
        );
        return;
      }
      const lease = connectionManager.readyRuntimeLease(connectionId);
      if (!lease || lease.generation !== generation || !lease.isCurrent()) {
        throw new Error("World watch target is unavailable");
      }
      const paneResult = await lease.runtime.herdr.call("pane.list", {}, 5_000);
      const panes = (paneResult as { panes?: unknown })?.panes;
      const matches = Array.isArray(panes)
        ? panes.filter(
            (pane) =>
              pane &&
              typeof pane === "object" &&
              (pane as Record<string, unknown>).terminal_id === terminalId,
          )
        : [];
      if (!lease.isCurrent() || matches.length !== 1) {
        throw new Error("World watch target is unavailable");
      }
      const result = worldWatchlist.pin({
        connection_id: connectionId,
        connection_generation: generation as number,
        terminal_id: terminalId,
        label: typeof identity?.label === "string" ? identity.label : "Watch",
      });
      if (result.changed) {
        publishWorldInvalidation(connectionId, generation as number);
        publishWatchlistChanged(result.revision);
      }
      sendReply(
        { id, result: { ...worldWatchlist.list(), changed: result.changed } },
        "world-watchlist-pin",
      );
    } catch (error) {
      sendError("world-watchlist-error", error);
    }
    return;
  }
  if (method.startsWith("world.")) {
    sendError(
      "unknown-world-method",
      new Error(`unknown bridge-global method: ${method}`),
    );
    return;
  }
  if (method.startsWith("connections.")) {
    try {
      let result: unknown;
      if (method === "connections.create") {
        result = await connectionProfiles.create(params?.profile ?? params);
      } else if (method === "connections.update") {
        result = await connectionProfiles.update(
          params?.id,
          params?.profile ?? params,
        );
      } else if (method === "connections.remove") {
        result = await connectionProfiles.remove(params?.id);
      } else if (method === "connections.set_default") {
        result = await connectionProfiles.setDefault(params?.id);
      } else if (method === "connections.connect") {
        result = await connectionProfiles.connect(params?.id);
      } else if (method === "connections.disconnect") {
        result = await connectionProfiles.disconnect(params?.id);
      } else if (method === "connections.test") {
        result = await connectionProfiles.test(params?.profile ?? params);
      } else {
        throw new Error(`unknown bridge-global method: ${method}`);
      }
      sendReply({ id, result }, "connections-mutation");
    } catch (error) {
      const message = sanitizeConnectionError(error);
      markRpcError(ws, id, message);
      sendReply({ id, error: { message } }, "connections-mutation-error");
    }
    return;
  }
  if (method === "bridge.pause_others") {
    const targets = Array.from(clients).filter((client) => client !== ws);
    let pausedClients = 0;
    for (const client of targets) {
      const ok = safeSend(
        client,
        JSON.stringify({
          control: {
            type: "pause_connection",
            reason:
              "Another Herdr World client paused this connection. Resume when you want this browser to sync again.",
          },
        }),
        "pause-other-client",
      );
      if (ok) pausedClients += 1;
    }
    sendReply(
      {
        id,
        result: {
          ok: true,
          paused_clients: pausedClients,
          clients: clients.size,
        },
      },
      "bridge-pause-others",
    );
    return;
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
  const {
    sshHost,
    herdr,
    worktreeParents,
    handleSettingsRpc,
    worktreeRemovalCoordinator,
    worktreeRemovalRuntime,
    terminalBridge,
  } = connection;
  const {
    listWorkspaceFiles,
    resolveWorkspaceFiles,
    readWorkspaceFile,
    searchWorkspaceFiles,
    revealWorkspaceFile,
    createWorkspaceDirectory,
    moveWorkspaceFile,
    readGitDiffSummary,
    readWorkspacePullRequest,
    readGitDiffFile,
    readGitCommits,
    readGitCommit,
    readGitCommitFile,
    readGitCommitPreview,
    runGitPull,
    runWorkspaceGitFileAction,
    runWorkspaceGitRepoAction,
  } = connection.files;
  const { enrichWorkspacesWithGitStatus, invalidateGitStatus } =
    connection.status;
  const {
    runWorktreeHook,
    worktreeRemoveHookContext,
    runWorktreeRemovedHook,
    runWorktreeOpenedHook,
    sourceWorkspaceForWorktreeCreate,
  } = connection.worktreeHooks;
  const {
    readHistory: readAgentMessageHistory,
    readSummary: readAgentSessionSummary,
    readEntry: readAgentHistoryEntry,
    readTurn: readAgentTurn,
  } = connection.agentSessions;

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

  // Town desk and agent moves: several confirmed pane moves on this exact
  // connection and runtime generation, with rollback (see world/desk-move).
  // The launcher: kinds and skills on this host, and a new agent in a new
  // tab, from a profile or a quick pick of a kind (agent/launch.ts).
  // Installed and logged in, per supported harness, from each harness's own
  // status command (agent/harness-readiness.ts). Onboarding uses it too.
  if (method === "launcher.readiness") {
    try {
      const kinds = await agentKinds((rpc, rpcParams) =>
        herdr.call(rpc, rpcParams, 10_000),
      );
      const readiness = await harnessReadiness({
        kinds,
        host: sshHost(),
        windows: sshHost()
          ? connection.remotePlatform === "windows"
          : process.platform === "win32",
        run: runProcessWithCodeTimeout,
        shQuote,
      });
      sendReply({ id, result: { readiness } }, method);
    } catch (error) {
      sendError(`${method}-error`, error);
    }
    return;
  }
  if (method === "launcher.login") {
    try {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = await openHarnessLogin(
        (rpc, rpcParams) => herdr.call(rpc, rpcParams, 10_000),
        {
          workspace_id: String(p.workspace_id ?? ""),
          kind: String(p.kind ?? ""),
          windows: sshHost()
            ? connection.remotePlatform === "windows"
            : process.platform === "win32",
          isCurrent: requestIsCurrent,
        },
      );
      sendReply({ id, result }, method);
    } catch (error) {
      sendError(`${method}-error`, error);
    } finally {
      if (route.scope === "connection" && route.isCurrent())
        publishWorldInvalidation(route.connectionId, route.generation);
    }
    return;
  }
  if (method === "launcher.catalog") {
    try {
      const p = (params ?? {}) as Record<string, unknown>;
      const call = (rpc: string, rpcParams: Record<string, unknown>) =>
        herdr.call(rpc, rpcParams, 10_000);
      const workspaceId = String(p.workspace_id ?? "");
      let cwd = "";
      if (workspaceId) {
        const listed = (await call("pane.list", {}).catch(() => null)) as {
          panes?: Record<string, unknown>[];
        } | null;
        const pane = listed?.panes?.find((x) => x.workspace_id === workspaceId);
        cwd = String(pane?.foreground_cwd || pane?.cwd || "");
      }
      const host = {
        host: sshHost(),
        windows: sshHost()
          ? connection.remotePlatform === "windows"
          : process.platform === "win32",
        run: runProcessWithCodeTimeout,
        shQuote,
      };
      const kinds = await agentKinds(call);
      const [skills, readiness] = await Promise.all([
        discoverSkills({ cwd, ...host }).catch(() => []),
        harnessReadiness({ kinds, ...host }).catch(() => []),
      ]);
      sendReply({ id, result: { kinds, skills, readiness } }, method);
    } catch (error) {
      sendError(`${method}-error`, error);
    }
    return;
  }
  if (method === "launcher.start") {
    try {
      const p = (params ?? {}) as Record<string, unknown>;
      const profileId = typeof p.profile_id === "string" ? p.profile_id : "";
      const profile = profileId ? profiles().profile(profileId) : null;
      if (profileId && !profile)
        throw new Error("That profile no longer exists.");
      const call = (rpc: string, rpcParams: Record<string, unknown>) =>
        herdr.call(rpc, rpcParams, 70_000);
      const result = await launchAgent(call, {
        workspace_id: String(p.workspace_id ?? ""),
        ...profileLaunch(profile ?? null, {
          kind: String(p.kind ?? ""),
          label: String(p.label ?? "")
            .trim()
            .slice(0, 64),
          text: String(p.text ?? "").slice(0, 16_000),
        }),
        isCurrent: requestIsCurrent,
      });
      if (profile && result.terminal_id && route.scope === "connection") {
        try {
          publishProfilesChanged(
            profiles().assign({
              connection_id: route.connectionId,
              terminal_id: result.terminal_id,
              profile_id: profile.id,
            }).revision,
          );
          if (profile.color && result.tab_id) {
            const workspaceIds = await moveWorkspaceIds(call, {
              workspace_id: String(p.workspace_id ?? ""),
            });
            publishBoardChanged(
              board().patch([
                {
                  op: "card.color",
                  key: tabCardKey(
                    route.connectionId,
                    result.tab_id,
                    workspaceIds,
                  ),
                  color: profile.color,
                },
              ]).revision,
            );
          }
        } catch (error) {
          logger.warn("A launched agent kept no profile record", {
            detail: String(error),
          });
        }
      }
      sendReply({ id, result }, method);
    } catch (error) {
      sendError(`${method}-error`, error);
    } finally {
      if (route.scope === "connection" && route.isCurrent())
        publishWorldInvalidation(route.connectionId, route.generation);
    }
    return;
  }
  if (method === "board.check_anchor") {
    try {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = await checkAnchor(
        (rpc, rpcParams) => herdr.call(rpc, rpcParams, 10_000),
        {
          kind: p.kind as "workspace" | "tab" | "pane",
          native_id: String(p.native_id ?? ""),
          isCurrent: requestIsCurrent,
        },
      );
      sendReply({ id, result }, method);
    } catch (error) {
      sendError(`${method}-error`, error);
    }
    return;
  }
  if (method === "board.send_note") {
    try {
      const p = (params ?? {}) as Record<string, unknown>;
      // Send what the saved board says, not the caller's copy: the string
      // and note must still be the ones the user saw.
      const linked =
        route.scope === "connection"
          ? linkedNoteText(board().get(), {
              connection_id: route.connectionId,
              pane_id: String(p.pane_id ?? ""),
              terminal_id: String(p.terminal_id ?? ""),
              note_id: String(p.note_id ?? ""),
              string_id: String(p.string_id ?? ""),
              note_rev: Number(p.note_rev),
            })
          : ({
              status: "refused",
              reason: "changed",
              message: "No host was named; nothing was sent.",
            } as const);
      const result =
        "text" in linked
          ? await sendNote(
              (rpc, rpcParams) => herdr.call(rpc, rpcParams, 15_000),
              {
                pane_id: String(p.pane_id ?? ""),
                terminal_id: String(p.terminal_id ?? ""),
                text: linked.text,
                recipient: linked.recipient,
                confirm_recipient:
                  typeof p.confirm_recipient === "string"
                    ? p.confirm_recipient
                    : undefined,
                isCurrent: requestIsCurrent,
              },
            )
          : linked;
      // A confirmed replacement (or a newer token for the same agent)
      // becomes the string's recipient.
      if ("text" in linked && result.status === "sent" && result.recipient)
        try {
          publishBoardChanged(
            board().patch([
              {
                op: "anchor.recipient",
                string_id: String(p.string_id ?? ""),
                end: linked.end,
                connection_id: route.connectionId,
                pane_id: String(p.pane_id ?? ""),
                terminal_id: String(p.terminal_id ?? ""),
                recipient: result.recipient,
              },
            ]).revision,
          );
        } catch (error) {
          logger.warn("Board could not record a string's agent", {
            detail: String(error),
          });
        }
      sendReply({ id, result }, method);
    } catch (error) {
      sendError(`${method}-error`, error);
    }
    return;
  }
  if (method === "town.move_desk" || method === "town.move_pane") {
    const call = (rpc: string, rpcParams: Record<string, unknown>) =>
      herdr.call(rpc, rpcParams, 15_000);
    // One move at a time per connection: each re-reads the topology (and the
    // last-desk check) only once the previous move has finished.
    let queue = townMoveQueues.get(route.connectionId);
    if (!queue) {
      queue = createMoveQueue();
      townMoveQueues.set(route.connectionId, queue);
    }
    try {
      const p = params ?? {};
      // The colours as the move starts: a close of the old tab seen during
      // the move must not lose the colour it carries over.
      let colorsBefore = board().get().layout.colors;
      const result = await queue(() => {
        colorsBefore = board().get().layout.colors;
        return method === "town.move_desk"
          ? moveDesk(call, {
              tab_id: String(p.tab_id ?? ""),
              workspace_id: String(p.workspace_id ?? ""),
              allow_close_room: p.allow_close_room === true,
              isCurrent: requestIsCurrent,
            })
          : movePane(call, {
              pane_id: String(p.pane_id ?? ""),
              tab_id: String(p.tab_id ?? ""),
              allow_close_room: p.allow_close_room === true,
              isCurrent: requestIsCurrent,
            });
      });
      // Board's strings follow the move whichever view or client made it.
      if (
        (result.status === "moved" || result.status === "failed") &&
        route.scope === "connection"
      ) {
        try {
          // A failed move may have left (or put back) panes under new IDs:
          // reconcile from what it positively observed.
          const ops =
            result.status === "moved"
              ? moveFollowOps(
                  board().get(),
                  route.connectionId,
                  method === "town.move_desk" ? String(p.tab_id ?? "") : null,
                  result,
                  method === "town.move_desk"
                    ? {
                        before: colorsBefore,
                        workspaceIds: await moveWorkspaceIds(call, result),
                      }
                    : undefined,
                )
              : reconcileOps(
                  board().get(),
                  route.connectionId,
                  result.topology ?? [],
                );
          if (ops.length) publishBoardChanged(board().patch(ops).revision);
        } catch (error) {
          logger.warn("Board strings did not follow a move", {
            detail: String(error),
          });
        }
      }
      sendReply({ id, result }, method);
    } catch (error) {
      sendError(`${method}-error`, error);
    }
    return;
  }

  if (method === "agent.list") {
    try {
      const result =
        connection.remotePlatform === "windows"
          ? await herdr.call("agent.list", params ?? {})
          : await connection.agentSessions.listWithActivity(params ?? {});
      sendReply({ id, result }, "agent-list");
    } catch (e) {
      sendError("agent-list-error", e);
    }
    return;
  }
  if (
    method === "agent_conversation.watch" ||
    method === "agent_conversation.unwatch"
  ) {
    try {
      const paneId = typeof params?.pane_id === "string" ? params.pane_id : "";
      if (!paneId) throw new Error(`${method} requires pane_id`);
      const watcher = connection.agentSessions.conversationWatch;
      if (method === "agent_conversation.watch") {
        watcher.watch(ws, paneId);
        let watchers = conversationWatchers.get(ws);
        if (!watchers) {
          watchers = new Set();
          conversationWatchers.set(ws, watchers);
        }
        watchers.add(watcher);
      } else {
        watcher.unwatch(ws, paneId);
      }
      sendReply({ id, result: { ok: true } }, method);
    } catch (e) {
      sendError(`${method}-error`, e);
    }
    return;
  }
  if (method === "agent_conversation.steps") {
    try {
      const p = params ?? {};
      const paneId = typeof p.pane_id === "string" ? p.pane_id : "";
      if (!paneId) throw new Error(`${method} requires pane_id`);
      const steps = await connection.agentSessions.conversation.steps({
        pane_id: paneId,
        // Bounded: History's window shows at most a few hundred calls.
        call_ids: (Array.isArray(p.call_ids) ? p.call_ids : [])
          .filter((callId): callId is string => typeof callId === "string")
          .slice(0, 500),
      });
      sendReply({ id, result: { steps } }, method);
    } catch (e) {
      sendError(`${method}-error`, e);
    }
    return;
  }
  if (
    method === "agent_conversation.get" ||
    method === "agent_conversation.latest" ||
    method === "agent_conversation.send" ||
    method === "agent_conversation.answer" ||
    method === "agent_conversation.dismiss"
  ) {
    try {
      const source = connection.agentSessions.conversation;
      const p = params ?? {};
      const paneId = typeof p.pane_id === "string" ? p.pane_id : "";
      if (method !== "agent_conversation.latest" && !paneId)
        throw new Error(`${method} requires pane_id`);
      const result =
        method === "agent_conversation.get"
          ? await source.read({ pane_id: paneId })
          : method === "agent_conversation.answer"
            ? await source.answer({
                pane_id: paneId,
                key: typeof p.key === "string" ? p.key : "",
                prompt_fingerprint:
                  typeof p.prompt_fingerprint === "string"
                    ? p.prompt_fingerprint
                    : "",
              })
            : method === "agent_conversation.dismiss"
              ? {
                  dismissed: source.dismiss({
                    pane_id: paneId,
                    delivery_id:
                      typeof p.delivery_id === "string" ? p.delivery_id : "",
                  }),
                }
              : method === "agent_conversation.send"
                ? await source.send({
                    pane_id: paneId,
                    text: typeof p.text === "string" ? p.text : "",
                    session_fingerprint:
                      typeof p.session_fingerprint === "string"
                        ? p.session_fingerprint
                        : "",
                    ...(Array.isArray(p.baseline)
                      ? {
                          baseline: p.baseline.filter(
                            (id): id is string => typeof id === "string",
                          ),
                        }
                      : {}),
                  })
                : paneId
                  ? await source.latest({ pane_id: paneId })
                  : {
                      conversations: await source.latestAll(
                        Array.isArray(p.pane_ids)
                          ? p.pane_ids.filter(
                              (id): id is string => typeof id === "string",
                            )
                          : undefined,
                      ),
                    };
      sendReply({ id, result }, method);
    } catch (e) {
      sendError(`${method}-error`, e);
    }
    return;
  }
  if (method === "agent_quest.list") {
    try {
      const ids = Array.isArray(params?.pane_ids)
        ? params.pane_ids.filter((id): id is string => typeof id === "string")
        : undefined;
      const quests = await connection.agentSessions.conversation.quests(ids);
      sendReply({ id, result: { quests } }, method);
    } catch (e) {
      sendError(`${method}-error`, e);
    }
    return;
  }
  if (method === "agent_history.get") {
    try {
      const result = await readAgentMessageHistory(params ?? {});
      sendReply({ id, result }, "agent-history-get");
    } catch (e) {
      sendError("agent-history-get-error", e);
    }
    return;
  }
  if (method === "agent_history.entry") {
    try {
      const result = await readAgentHistoryEntry(params ?? {});
      sendReply({ id, result }, "agent-history-entry");
    } catch (e) {
      sendError("agent-history-entry-error", e);
    }
    return;
  }
  if (method === "agent_session.get") {
    try {
      const result = await readAgentSessionSummary(params ?? {});
      sendReply({ id, result }, "agent-session-get");
    } catch (e) {
      sendError("agent-session-get-error", e);
    }
    return;
  }
  if (method === "agent_turn.get") {
    try {
      const result = await readAgentTurn(params ?? {});
      sendReply({ id, result }, "agent-turn-get");
    } catch (e) {
      sendError("agent-turn-get-error", e);
    }
    return;
  }
  if (method === "agent_checkout.get") {
    try {
      const result = await connection.agentCheckout(params ?? {});
      sendReply({ id, result }, "agent-checkout-get");
    } catch (e) {
      sendError("agent-checkout-get-error", e);
    }
    return;
  }
  if (
    method === "agent_session.link_preview" ||
    method === "agent_session.link"
  ) {
    try {
      const result = await dispatchAgentSessionLink(
        route,
        method,
        params ?? {},
      );
      sendReply({ id, result }, method);
    } catch (e) {
      sendError("agent-session-link-error", e);
    }
    return;
  }
  if (method === "file.list") {
    try {
      const result = await listWorkspaceFiles(params ?? {});
      sendReply({ id, result }, "file-list");
    } catch (e) {
      sendError("file-list-error", e);
    }
    return;
  }
  if (method === "file.resolve") {
    try {
      const result = await resolveWorkspaceFiles(params ?? {});
      sendReply({ id, result }, "file-resolve");
    } catch (e) {
      sendError("file-resolve-error", e);
    }
    return;
  }
  if (method === "file.mkdir" || method === "file.move") {
    try {
      const result = await (method === "file.mkdir"
        ? createWorkspaceDirectory
        : moveWorkspaceFile)(params ?? {});
      sendReply({ id, result }, method);
    } catch (e) {
      sendError(`${method}-error`, e);
    }
    return;
  }
  if (method === "file.read") {
    try {
      const result = await readWorkspaceFile(params ?? {});
      sendReply({ id, result }, "file-read");
    } catch (e) {
      sendError("file-read-error", e);
    }
    return;
  }
  if (method === "file.search") {
    try {
      const result = await searchWorkspaceFiles(params ?? {});
      sendReply({ id, result }, "file-search");
    } catch (e) {
      sendError("file-search-error", e);
    }
    return;
  }
  if (method === "file.reveal") {
    try {
      const result = await revealWorkspaceFile(params ?? {}, ws.remoteAddress);
      sendReply({ id, result }, "file-reveal");
    } catch (e) {
      sendError("file-reveal-error", e);
    }
    return;
  }
  if (method === "git.diff_summary") {
    try {
      const result = await readGitDiffSummary(params ?? {});
      sendReply({ id, result }, "git-diff-summary");
    } catch (e) {
      sendError("git-diff-summary-error", e);
    }
    return;
  }
  if (method === "git.pull_request") {
    try {
      const result = await readWorkspacePullRequest(params ?? {});
      sendReply({ id, result }, "git-pull-request");
    } catch {
      // Root resolution errors may include remote URLs or CLI diagnostics.
      sendError(
        "git-pull-request-error",
        new Error("Cannot resolve this workspace's Git checkout."),
      );
    }
    return;
  }
  if (method === "git.diff_file") {
    try {
      const result = await readGitDiffFile(params ?? {});
      sendReply({ id, result }, "git-diff-file");
    } catch (e) {
      sendError("git-diff-file-error", e);
    }
    return;
  }
  if (
    method === "git.commits" ||
    method === "git.commit" ||
    method === "git.commit_file" ||
    method === "git.commit_preview"
  ) {
    try {
      const result =
        method === "git.commits"
          ? await readGitCommits(params ?? {})
          : method === "git.commit"
            ? await readGitCommit(params ?? {})
            : method === "git.commit_file"
              ? await readGitCommitFile(params ?? {})
              : await readGitCommitPreview(params ?? {});
      sendReply({ id, result }, method);
    } catch (e) {
      sendError(`${method}-error`, e);
    }
    return;
  }
  if (method === "git.pull") {
    try {
      const result = await runGitPull(params ?? {});
      invalidateGitStatus(result.root);
      sendReply({ id, result }, "git-pull");
    } catch (e) {
      sendError("git-pull-error", e);
    }
    return;
  }
  if (method === "git.file_action") {
    try {
      const result = await runWorkspaceGitFileAction(params ?? {});
      invalidateGitStatus(result.root);
      sendReply({ id, result }, "git-file-action");
    } catch (e) {
      sendError("git-file-action-error", e);
    }
    return;
  }
  if (method === "git.repo_action") {
    try {
      const result = await runWorkspaceGitRepoAction(params ?? {});
      invalidateGitStatus(result.root);
      sendReply({ id, result }, "git-repo-action");
    } catch (e) {
      sendError("git-repo-action-error", e);
    }
    return;
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
  if (method === "worktree.create") {
    try {
      const result = await createWorkspaceWorktree(
        connection,
        params ?? {},
        requestIsCurrent,
        (error) => {
          if (!requestIsCurrent()) return;
          logger.warn("unable to persist worktree parent", {
            connection: connectionId,
            error: sanitizeConnectionError(error),
          });
        },
      );
      sendReply(
        {
          id,
          result,
        },
        "worktree-create",
      );
    } catch (e) {
      sendError("worktree-create-error", e);
    }
    return;
  }
  if (method === "worktree.open") {
    try {
      const workspaceId = String(params?.workspace_id ?? "");
      const sourceWorkspace = await sourceWorkspaceForWorktreeCreate(
        params ?? {},
      );
      const result = await herdr.call(method, params ?? {});
      await worktreeParents
        .rememberWorktreeParent(result, workspaceId, requestIsCurrent)
        .catch((error) => {
          if (!requestIsCurrent()) return;
          logger.warn("unable to persist opened worktree parent", {
            connection: connectionId,
            error: sanitizeConnectionError(error),
          });
        });
      const openedHook = await runWorktreeOpenedHook(result, sourceWorkspace);
      sendReply(
        {
          id,
          result: { ...result, opened_hook: openedHook },
        },
        "worktree-open",
      );
    } catch (e) {
      sendError("worktree-open-error", e);
    }
    return;
  }
  if (method === "worktree.remove") {
    try {
      const workspaceId = String(params?.workspace_id ?? "");
      const result = await worktreeRemovalCoordinator.run(
        workspaceId,
        async () => {
          const removeHookContext = await worktreeRemoveHookContext(
            params ?? {},
          );
          const checkoutState = removeHookContext
            ? await worktreeRemovalRuntime
                .inspectCheckout(removeHookContext.checkoutPath)
                .catch(() => "unknown" as const)
            : "unknown";
          const beforeRemoveHook =
            removeHookContext && checkoutState !== "missing"
              ? await runWorktreeHook({
                  hook: "teardown",
                  checkoutPath: removeHookContext.checkoutPath,
                  sourceCheckoutPath: removeHookContext.sourceCheckoutPath,
                  repoSettingsKey: removeHookContext.repoSettingsKey,
                })
              : ({
                  event: "worktree.before_remove",
                  status: "skipped",
                } as const);
          if (beforeRemoveHook.status === "failed") {
            markRpcError(
              ws,
              id,
              beforeRemoveHook.error || "before-remove hook failed",
            );
            return {
              ok: false,
              skipped_remove: true,
              before_remove_hook: beforeRemoveHook,
            };
          }

          const removal = await removeWorktreeWithRecovery({
            call: (name, callParams) =>
              herdr.call(name, callParams, WORKTREE_REMOVE_TIMEOUT_MS),
            params: params ?? {},
            checkoutPath: removeHookContext?.checkoutPath,
            runtime: worktreeRemovalRuntime,
          });
          if (removal.cleanup?.preserved_path) {
            logger.warn("preserved stale worktree files", {
              connection: connectionId,
              path: removal.cleanup.preserved_path,
            });
          }
          if (removeHookContext?.checkoutPath) {
            await worktreeParents
              .forgetWorktree(removeHookContext.checkoutPath, requestIsCurrent)
              .catch((error) => {
                if (!requestIsCurrent()) return;
                logger.warn("unable to remove worktree parent", {
                  connection: connectionId,
                  error: sanitizeConnectionError(error),
                });
              });
          }
          const removedHook = await runWorktreeRemovedHook(removeHookContext);
          return {
            ...removal.result,
            ...(removal.cleanup ? { cleanup: removal.cleanup } : {}),
            before_remove_hook: beforeRemoveHook,
            removed_hook: removedHook,
          };
        },
      );
      sendReply({ id, result }, "worktree-remove");
    } catch (e) {
      sendError("worktree-remove-error", e);
    }
    return;
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
          workspace_id: url.searchParams.get("workspace_id"),
          path: url.searchParams.get("path"),
          scope: url.searchParams.get("scope"),
          inline: url.searchParams.get("inline") === "1",
          range: req.headers.get("range") ?? undefined,
          if_range: req.headers.get("if-range") ?? undefined,
        });
      } catch (error) {
        response = new Response((error as Error).message, { status: 400 });
      }
    } else if (endpoint === "file-upload") {
      try {
        const result = await connection.files.uploadWorkspaceFile(
          {
            workspace_id: url.searchParams.get("workspace_id"),
            directory: url.searchParams.get("directory"),
            filename: url.searchParams.get("filename"),
          },
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
        const result = await connection.files.deleteWorkspaceFile({
          workspace_id: url.searchParams.get("workspace_id"),
          path: url.searchParams.get("path"),
        });
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
