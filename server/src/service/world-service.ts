import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import type { Server, ServerWebSocket } from "bun";
import { createProfileServices } from "../agent/profile-service";
import { createAssistantContext } from "../assistant/context";
import { HerdrClient } from "../bridge/herdr-client";
import type { SshTunnelConfig } from "../bridge/ssh-tunnel";
import { WorldSnapshotAdmission } from "../bridge/world-snapshot-admission";
import { authTokenPrintCommand } from "../config/auth-token";
import type { DataPaths } from "../config/data-paths";
import { acquireInstanceLock } from "../config/instance-lock";
import type { ServerConfig } from "../config/server-config";
import { listenerSessionSecret } from "../config/session-secret";
import {
  ConnectionManager,
  type ConnectionRuntimeContext,
  sanitizeConnectionError,
} from "../connections/manager";
import {
  ConnectionProfileService,
  connectionIdentityForProfile,
  loadConnectionProfileBootstrap,
  type StartupLocalProfile,
} from "../connections/profile-service";
import {
  type ConnectionProfile,
  connectionRecoveryFingerprint,
} from "../connections/profiles";
import {
  createLegacyRoutingLogger,
  resolveReadyConnection,
  serializeHerdrEventEnvelope,
} from "../connections/protocol";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import { createSshProfileRuntimeConfig } from "../connections/ssh-profile-runtime";
import { bindListenerBeforeConnectionStart } from "../connections/startup";
import { STARTUP_DEFAULT_CONNECTION_ID } from "../connections/types";
import { createAuthHandlers } from "../http/auth";
import {
  createHerdrSetupHandlers,
  herdrSetupGuardForProfile,
} from "../http/herdr-setup";
import { createUpdateHandlers } from "../http/update";
import { createWebPushService } from "../notifications/web-push";
import type { RpcServices } from "../rpc/context";
import {
  createSourcesHttpHandler,
  storedSourceSettings,
  withSourceSettings,
} from "../sources/http";
import { CheckoutResolver } from "../sources/links";
import { readSourceSecrets, writeSourceSecrets } from "../sources/secrets";
import { SourcesService } from "../sources/service";
import { herdrEventName } from "../utils/herdr-events";
import {
  createRecoveryReporter,
  type RecoveryReporter,
  serverLogger,
} from "../utils/logger";
import { runProcessWithCodeTimeout, shQuote } from "../utils/process-utils";
import { createWorkspaceWorktree } from "../worktree/create";
import { afterHerdrClose } from "../world/board-closing";
import {
  type ObservedAgent,
  readPaneRecipient,
  recipientOps,
} from "../world/board-recipient";
import type { BoardOp } from "../world/board-store";
import type { createMoveQueue } from "../world/desk-move";
import { createWorldDeskService } from "../world/desk-service";
import { reconcileReadyInterest } from "../world/interest-prune";
import { serializeWorldInvalidation } from "../world/invalidation";
import { OfficeObservabilityService } from "../world/observability";
import {
  createOfficeObservabilityHttpHandler,
  resolveOfficeObservabilityBootstrap,
  withOfficeObservabilityEndpoint,
} from "../world/observability-http";
import { createRevisionPublisher } from "../world/revision-publisher";
import { WorldSnapshotService } from "../world/snapshot";
import { createTerminalMarks } from "../world/terminal-marks";
import { createWorldCliService } from "../world/world-cli-service";
import { FocusedAcquisition } from "../world/focused-acquisition";
import { readFocusedLists } from "../world/focused-lists";
import { AgentActivityCache } from "../world/agent-activity-cache";
import { DeskWatches } from "../world/desk-watches";
import { readDeskWatch } from "../world/desk-watch-read";
import { createBrowserClients, logDetail } from "./clients";
import { listen } from "./listener";
import type { Clock, Scheduler, WorldAdapters } from "./ports";
import { createRpcDispatcher } from "./rpc-dispatch";
import type { OpenStorage, WorldStorage } from "./storage";

/** Everything a World service takes from its process; nothing else is global. */
export type WorldServiceDeps = {
  config: ServerConfig;
  /** The data folder this service owns from creation until stop. */
  paths: DataPaths;
  clock: Clock;
  scheduler: Scheduler;
  storage: OpenStorage;
  adapters: WorldAdapters;
  /** After an installed update: end the process so its supervisor restarts it. */
  scheduleProcessExit(): void;
};

export type WorldService = Awaited<ReturnType<typeof createWorldService>>;

/** How long stop waits for requests that were running when it began. */
const DRAIN_TIMEOUT_MS = 2_000;

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

/**
 * Claim the data folder, open storage and build one World service. Nothing
 * listens or connects until `start()`; `stop()` drains and releases it all.
 */
export async function createWorldService(deps: WorldServiceDeps) {
  const { config, paths } = deps;
  // One live World per data folder; nothing in it is written before this.
  const releaseDataFolder = acquireInstanceLock(paths.root, config.port);
  let storage: WorldStorage;
  let sessionSecret: string;
  try {
    sessionSecret = listenerSessionSecret(config, paths.sessionSecret);
    storage = await deps.storage(paths, {
      clock: deps.clock,
      scheduler: deps.scheduler,
    });
  } catch (error) {
    releaseDataFolder();
    throw error;
  }
  try {
    return await compose(deps, storage, sessionSecret, releaseDataFolder);
  } catch (error) {
    await storage.close().catch(() => {});
    releaseDataFolder();
    throw error;
  }
}

async function compose(
  deps: WorldServiceDeps,
  storage: WorldStorage,
  sessionSecret: string,
  releaseDataFolder: () => void,
) {
  const { config, paths, clock, scheduler, adapters } = deps;
  const logger = serverLogger;
  const settings = storage.settings;
  // Set when stop begins: nothing new is admitted or started after it.
  let stopping = false;
  // Cleared when storage closes: no write may reach the folder after it.
  let storageOpen = true;
  const serviceIncarnation = storage.incarnation ?? randomUUID();
  const snapshotAdmission = new WorldSnapshotAdmission();
  /** Town moves run one at a time per connection (see world/desk-move). */
  const townMoveQueues = new Map<string, ReturnType<typeof createMoveQueue>>();
  const webPush = createWebPushService({
    path: paths.webPush,
    warn: (message) => logger.warn(message),
  });
  const officeObservabilityBootstrap = await settings
    .read()
    .then((current) => resolveOfficeObservabilityBootstrap(current))
    .catch(() => {
      logger.warn("invalid Office observability configuration was disabled");
      return { endpoint: null, source: "none" as const };
    });
  const officeObservability = new OfficeObservabilityService({
    ...officeObservabilityBootstrap,
    now: () => clock.now(),
  });
  const handleOfficeObservability = createOfficeObservabilityHttpHandler({
    service: officeObservability,
    persist: async (endpoint) => {
      await settings.update((current) =>
        withOfficeObservabilityEndpoint(current, endpoint),
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
  const auth = createAuthHandlers({
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
  const update = createUpdateHandlers({
    appVersion: config.appVersion,
    runProcessWithCodeTimeout,
    shQuote,
    scheduleProcessExit: deps.scheduleProcessExit,
  });
  let connectionRevision = 0;
  function publishConnectionsChanged() {
    if (stopping) return;
    broadcast(
      JSON.stringify({
        control: {
          type: "world_connections_changed",
          revision: ++connectionRevision,
        },
      }),
      "world-connections-changed",
    );
  }
  const browsers = createBrowserClients({
    logger,
    clock,
    forEachRuntime: (visit) => connectionManager.forEachCurrentRuntime(visit),
    closed: (socket) => {
      focusedAcquisition.release(socket);
      deskWatches.release(socket);
    },
    countChanged: publishConnectionsChanged,
  });
  const { clients, safeSend, broadcast, clientLabel, markRpcError } = browsers;
  const legacyRoutingLogger = createLegacyRoutingLogger({
    log: (message) =>
      logger.warn("deprecated request routing", { detail: message }),
  });

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
      store: storage.connections,
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
  let worldSnapshots: WorldSnapshotService<LegacyConnectionRuntime> | null =
    null;
  const deskService = createWorldDeskService((line) =>
    broadcast(line, "world-desk"),
  );
  const board = () => storage.board();
  const revisionPublisher = createRevisionPublisher(clients, safeSend);
  // Profiles stay World's; per-terminal settings live in Herdr pane metadata.
  const {
    profiles,
    terminalSettings,
    publishProfilesChanged,
    observeTerminalSettings,
  } = createProfileServices(
    revisionPublisher,
    () => connectionManager,
    () => storage.profiles(),
    () => clock.now(),
  );

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

  const publishBoardChanged = revisionPublisher(
    "world_board_changed",
    "world-board",
  );

  /** The agent CLI (world-cli-service.ts). */
  const worldCli = createWorldCliService({
    board,
    ledger: () => storage.ledger(),
    attention: () => storage.attention(),
    clock,
    scheduler,
    now: () => clock.now(),
    incarnation: storage.incarnation,
    connections: () => connectionManager,
    snapshots: () => worldSnapshots,
    sources: async () => worldSources.current(),
    townMoveQueues,
    publishBoard: publishBoardChanged,
    broadcast: (line) => broadcast(line, "world-ledger"),
  });

  const {
    retire: retireTerminalMarks,
    observe: observeHost,
    ...terminalMarks
  } = createTerminalMarks(revisionPublisher, deskService.observe);

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
    broadcast(line, "world-invalidation");
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
      focusedAcquisition.reconcile();
      deskWatches.reconcile();
      publishConnectionsChanged();
      deskService.retire(status.id, status.generation);
      retireTerminalMarks(status.id, status.generation);
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
  const agentActivity = new AgentActivityCache({
    clock,
    active: (owner) => focusedAcquisition.holdersFor(owner).size > 0,
    changed(owner, agents) {
      for (const socket of [...focusedAcquisition.holdersFor(owner)])
        safeSend(
          socket,
          JSON.stringify({
            control: { type: "world_agent_activity", ...owner, agents },
          }),
          "world-agent-activity",
        );
    },
  });
  const focusedAcquisition = new FocusedAcquisition<ServerWebSocket<unknown>>({
    scheduler,
    released: (owner) => agentActivity.clear(owner),
    lease(owner) {
      const lease = connectionManager.readyRuntimeLease(owner.connection_id);
      if (
        !lease ||
        lease.generation !== owner.connection_generation ||
        !lease.isCurrent()
      )
        return null;
      return {
        isCurrent: lease.isCurrent,
        read: () =>
          readFocusedLists(lease.runtime, {
            cache: agentActivity,
            owner,
            isCurrent: lease.isCurrent,
            force: true,
          }),
      };
    },
    send: (socket, control) =>
      safeSend(socket, JSON.stringify({ control }), "world-focused-changed"),
  });
  const deskWatches = new DeskWatches<ServerWebSocket<unknown>>({
    scheduler,
    lease(target) {
      const lease = connectionManager.readyRuntimeLease(target.connection_id);
      if (
        !lease ||
        lease.generation !== target.connection_generation ||
        !lease.isCurrent()
      )
        return null;
      return {
        isCurrent: lease.isCurrent,
        read: (kind, target) =>
          readDeskWatch(lease.runtime, kind, target, lease.isCurrent),
      };
    },
    send: (socket, control) =>
      safeSend(socket, JSON.stringify({ control }), "world-desk-reads"),
  });
  worldSnapshots = new WorldSnapshotService(
    connectionManager,
    () => clock.now(),
    (connectionId, generation) =>
      publishWorldInvalidation(connectionId, generation, true),
    undefined,
    () => terminalMarks.worldWatchlist.list(),
    observeHost,
    observeTerminalSettings,
    serviceIncarnation,
  );

  const assistantContext = createAssistantContext({
    catalog: () => connectionProfiles.list(),
    lease: (id) => connectionManager.readyRuntimeLease(id),
    recoveryFingerprint: (id) => {
      const profile = connectionProfiles
        .list()
        .find((profile) => profile.id === id);
      if (!profile)
        throw new Error("Ranger connection is no longer configured");
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
      ReturnType<typeof import("../assistant/service").createAssistantService>
    >
  > | null = null;
  function getAssistantService() {
    // Ranger started now would outlive stop and its data folder.
    if (stopping) return Promise.reject(new Error("World is stopping"));
    assistantServiceTask ??= import("../assistant/service")
      .then(({ createAssistantService }) =>
        createAssistantService({
          context: assistantContext,
          directory: paths.assistant,
          publish: (snapshot) => {
            broadcast(
              JSON.stringify({ assistant: snapshot }),
              "assistant",
              "assistant",
            );
          },
          notify: (notification) => {
            broadcast(
              JSON.stringify({ assistant_notification: notification }),
              "assistant_notification",
            );
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
    if (stopping) return;
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

  const herdrSetup = createHerdrSetupHandlers({
    ping: () => {
      const runtime = connectionManager.defaultReadyRuntime();
      return runtime
        ? runtime.herdr.ping()
        : new HerdrClient(config.socketPath).ping();
    },
    guard: () => herdrSetupGuardForProfile(config, defaultConnectionProfile()),
    upgrade: {
      worldVersion: config.appVersion,
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
        runtime = adapters.herdr.createRuntime({
          identity,
          connectionGeneration: context.generation,
          config: profileConfig,
          settings,
          logger: logger.child("connection"),
          safeSend,
          broadcast,
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
              broadcast(line, "event");
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
      return runtime;
    };
  }

  const connectionProfiles = new ConnectionProfileService({
    manager: connectionManager,
    store: storage.connections,
    changed: publishConnectionsChanged,
    bootstrap: connectionBootstrap,
    createRuntime: runtimeFactoryForProfile,
    retry: {
      schedule: (callback, delayMs) => scheduler.schedule(callback, delayMs),
    },
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
    settings: await settings
      .read()
      .then(storedSourceSettings)
      .catch(() => ({})),
    persistSettings: async (sources) => {
      await settings.update((current) => withSourceSettings(current, sources));
    },
    secrets: {
      read: () => readSourceSecrets(paths.sourceSecrets),
      write: (secrets) => {
        if (!storageOpen) throw new Error("World storage is closed");
        writeSourceSecrets(secrets, paths.sourceSecrets);
      },
    },
    run: runSourceProcess,
    topology: async () =>
      worldSnapshots ? (await worldSnapshots.snapshot()).connections : [],
    runtimeOwners: () =>
      connectionManager
        .list()
        .flatMap(({ id, generation }) =>
          connectionManager.currentRuntime(id)
            ? [{ connection_id: id, generation }]
            : [],
        ),
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
    now: () => clock.now(),
  });
  const handleWorldSources = createSourcesHttpHandler(worldSources);

  const rpcServices: RpcServices = {
    bindings: storage.bindings,
    serviceIncarnation,
    bindBoardRecipients,
    board,
    clients,
    connectionManager,
    connectionProfiles,
    focusedAcquisition,
    agentActivity,
    deskWatches,
    conversationWatchers: browsers.conversationWatchers,
    getAssistantService,
    logger,
    markRpcError,
    profiles,
    terminalSettings,
    publishBoardChanged,
    publishProfilesChanged,
    publishWorldInvalidation,
    safeSend,
    snapshotAdmission,
    townMoveQueues,
    ...terminalMarks,
    worldDesk: deskService.registry,
    publishDeskChanged: deskService.publish,
    worldCli,
    worldSnapshots,
  };
  const handleRpc = createRpcDispatcher(rpcServices, legacyRoutingLogger);

  // Requests and socket messages still running; stop waits for them.
  const inFlight = new Set<Promise<unknown>>();
  function track<T>(work: Promise<T>): Promise<T> {
    inFlight.add(work);
    void work.then(
      () => inFlight.delete(work),
      () => inFlight.delete(work),
    );
    return work;
  }
  function drained(): Promise<void> {
    if (!inFlight.size) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = scheduler.schedule(() => {
        logger.warn("World stopped with requests still running", {
          requests: inFlight.size,
        });
        resolve();
      }, DRAIN_TIMEOUT_MS);
      void Promise.allSettled([...inFlight]).then(() => {
        timer.cancel();
        resolve();
      });
    });
  }

  /** Dispose Ranger if it was started; stopping keeps a new one from starting. */
  async function disposeAssistant() {
    const task = assistantServiceTask;
    assistantServiceTask = null;
    await task?.then((service) => service.dispose()).catch(() => {});
  }

  let server: Server<{ sessionToken: string | null }> | null = null;
  let startTask: Promise<void> | null = null;
  let stopTask: Promise<void> | null = null;
  void storage.failed
    ?.then(async (error) => {
      logger.error("World storage failed; stopping this service", {
        error: sanitizeConnectionError(error),
      });
      stopTask ??= stopService();
      await stopTask;
    })
    .catch((error) =>
      logger.error("Storage-failure shutdown failed", {
        error: sanitizeConnectionError(error),
      }),
    );

  return {
    paths,
    storage,
    failed: storage.failed,
    /** The listener's port once started. */
    get port(): number | undefined {
      return server?.port;
    },
    /**
     * Bind the listener, then start configured connections and Ranger in the
     * background; a port conflict therefore fails before any connection.
     */
    start(): { port: number; connected: Promise<void> } {
      if (stopTask) throw new Error("World service is stopped");
      if (server) throw new Error("World service already started");
      server = bindListenerBeforeConnectionStart({
        bindListener: () =>
          listen({
            serviceIncarnation,
            config,
            clock,
            logger,
            auth,
            browsers,
            connectionManager,
            legacyRoutingLogger,
            snapshotAdmission,
            handleRpc,
            webPush,
            worldCli,
            settings,
            update,
            herdrSetup,
            officeObservability: handleOfficeObservability,
            sources: handleWorldSources,
            track,
            stopping: () => stopping,
          }),
        startConnection: () => {
          startTask = startConnections();
          return startTask;
        },
        onConnectionError: (error) => {
          logger.warn("default connection startup failed", {
            error: sanitizeConnectionError(error),
          });
        },
      });
      worldCli.start();
      return {
        port: server.port ?? config.port,
        connected: startTask!.catch(() => {}),
      };
    },
    /**
     * Drain and release everything, closing the listener last; safe to call
     * more than once. A process about to exit passes `keepListener`, so the
     * port stays bound until its exit: launchd's restart waits for the port
     * to free before it starts the next process (service-manager.ts).
     */
    async stop(options: { keepListener?: boolean } = {}): Promise<void> {
      stopTask ??= stopService();
      await stopTask;
      if (!options.keepListener) await server?.stop(true);
    },
    /** For a dying process: release the data folder without draining. */
    releaseDataFolder,
  };

  async function startConnections() {
    await connectionProfiles.startConfigured();
    // Stopping fences startup: Ranger must not start after stop began.
    if (stopping) return;
    // Resume saved work even when no browser has opened Ranger yet.
    await getAssistantService();
    resumeAssistantIfLoaded();
    browsers.notifyBrowserClientCount();
    const runtime = connectionManager.defaultReadyRuntime();
    // Stopping the runtime fails this call, so stop can wait for it.
    await runtime?.herdr
      .ping()
      .then((ping) =>
        logger.info("Herdr reachable", {
          connection: runtime.identity.id,
          version: ping.version,
          protocol: ping.protocol,
        }),
      )
      .catch((error) => {
        if (stopping) return;
        logger.warn("Herdr not reachable yet", {
          connection: runtime.identity.id,
          error: sanitizeConnectionError(error),
          action: "run `herdr-world herdr setup`; RPCs retry per request",
        });
      });
  }

  async function stopService() {
    // Admit nothing new: requests get 503 while the port stays bound, and no
    // reconnect, push, Ranger start or wait for an answer begins.
    stopping = true;
    focusedAcquisition.stop();
    deskWatches.stop();
    connectionProfiles.stopSupervision();
    webPush.stop();
    await worldCli.stop();
    // Drop browser sockets as a process exit does; pages reconnect.
    for (const ws of [...browsers.clients]) ws.terminate();
    try {
      // Stop what in-flight work waits on: Ranger, then every runtime, which
      // also fails the Herdr calls still waiting. Startup then settles
      // fenced, and so does every request, within a bound.
      await disposeAssistant();
      await connectionManager.stopAll();
      await startTask?.catch(() => {});
      await disposeAssistant();
      await drained();
    } finally {
      try {
        storageOpen = false;
        await storage.close();
      } finally {
        releaseDataFolder();
      }
    }
  }
}
