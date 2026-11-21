import { composeBoardData } from "./board-element-sources";
import { weatherCliHandler } from "../weather/cli";
import { findHerdrBinary } from "../herdr/bootstrap";
import { createUiSettingsRpcHandler } from "../bridge/settings-rpc";
import { createCoreInstall } from "../herdr-core/install";
import { createSharedTerminalMarks } from "./terminal-mark-service";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import type { Server, ServerWebSocket } from "bun";
import { createProfileServices } from "../agent/profile-service";
import { createRuntimeAssistantContext } from "./assistant-context";
import { HerdrClient } from "../bridge/herdr-client";
import { createServiceForwards } from "./forward-service";
import { sweepOrphanedSshMasters } from "../bridge/ssh-master";
import type { SshTunnelConfig } from "../bridge/ssh-tunnel";
import { WorldSnapshotAdmission } from "../bridge/world-snapshot-admission";
import { authTokenPrintCommand } from "../config/auth-token";
import { acquireInstanceLock } from "../config/instance-lock";
import { publishInstanceAddress } from "./instance-address";
import { listenerSessionSecret } from "../config/session-secret";
import { startupConnectionSettings } from "../connections/profile-creation";
import {
  ConnectionManager,
  type ConnectionRuntimeContext,
  sanitizeConnectionError,
} from "../connections/manager";
import {
  ConnectionProfileService,
  connectionIdentityForProfile,
  type StartupLocalProfile,
} from "../connections/profile-service";
import { initializeConnectionProfiles } from "../connections/first-run";
import { connectionFailureReporters } from "../connections/failure-reporters";
import { type TuiConnectionProfile } from "../connections/profiles";
import { composeCore } from "../rpc/core";
import { coreCallerSource } from "../herdr-core/ask-caller";
import { ownedBy, worldRuntimeRegistry } from "../world/runtime-registry";
import {
  createLegacyRoutingLogger,
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
import { connectionTaskPush } from "../notifications/task-push";
import type { ObservedSnapshots, RpcServices } from "../rpc/context";
import { composeSources, runSourceProcess } from "../sources/composition";
import { ShipyardService } from "../shipyard/service";
import { ShipyardInstances } from "../shipyard/instances";
import { shipyardInstanceIdentity } from "../shipyard/identity";
import { createShipyardHttp } from "../shipyard/http";
import { withIntegrations } from "../integrations/http";
import { herdrEventName } from "../utils/herdr-events";
import { serverLogger } from "../utils/logger";
import { runProcessWithCodeTimeout, shQuote } from "../utils/process-utils";
import { afterHerdrClose } from "../world/board-closing";
import { createApartmentsService } from "./apartments-service";
import { createBinService } from "./bin-service";
import { inFlightWork } from "./in-flight";
import type { createMoveQueue } from "../world/desk-move";
import { reconcileReadyInterest } from "../world/interest-prune";
import { serializeWorldInvalidation } from "../world/invalidation";
import { composeWorldUsage, type ComposedWorldUsage } from "./usage-analytics";
import { createUsageTelemetry } from "./usage-telemetry";
import { createRevisionPublisher } from "../world/revision-publisher";
import { WorldSnapshotService } from "../world/snapshot";
import { createWorldCliService } from "../world/world-cli-service";
import { createRuntimeMemoryService } from "../memory/runtime-service";
import { FocusedAcquisition } from "../world/focused-acquisition";
import { readFocusedLists } from "../world/focused-lists";
import { AgentActivityCache } from "../world/agent-activity-cache";
import { DeskWatches } from "../world/desk-watches";
import { readDeskWatch } from "../world/desk-watch-read";
import { createBrowserClients, summarizeHerdrEvent } from "./clients";
import { listen } from "./listener";
import type { WorldServiceDeps } from "./ports";
import { createRpcDispatcher } from "./rpc-dispatch";
import type { WorldStorage } from "./storage";

export type { WorldServiceDeps } from "./ports";

export type WorldService = Awaited<ReturnType<typeof createWorldService>>;

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
    await storage.connections.acquireServiceOwnership();
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
  releaseDataFolder: ReturnType<typeof acquireInstanceLock>,
) {
  const { config, paths, clock, scheduler, adapters } = deps;
  const logger = serverLogger;
  const settings = storage.settings;
  // Stop fences admission/startup; storage closure fences writes to the folder.
  let stopping = false;
  let storageOpen = true;
  const serviceIncarnation = storage.incarnation ?? randomUUID();
  const snapshotAdmission = new WorldSnapshotAdmission();
  /** Town moves run one at a time per connection (see world/desk-move). */
  const townMoveQueues = new Map<string, ReturnType<typeof createMoveQueue>>();
  const webPush = createWebPushService({
    path: paths.webPush,
    warn: (message) => logger.warn(message),
  });
  const { officeObservability, handleOfficeObservability } =
    await createUsageTelemetry(settings, () => clock.now(), logger);
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
    sockets: () => [focusedAcquisition, deskWatches, core.pages],
    countChanged: publishConnectionsChanged,
  });
  const { clients, safeSend, broadcast, clientLabel, markRpcError } = browsers;
  const forwards = createServiceForwards(
    config,
    logger,
    broadcast,
    () => stopping,
  );
  const legacyRoutingLogger = createLegacyRoutingLogger({
    log: (message) =>
      logger.warn("deprecated request routing", { detail: message }),
  });

  const { startupDefaultProfile, explicitStartupOverride } =
    startupConnectionSettings(config);
  let connectionBootstrap;
  try {
    connectionBootstrap = await initializeConnectionProfiles({
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

  const readyConnectionGenerations = new Map<string, number>();
  let worldSnapshots: ObservedSnapshots | null = null;
  let worldUsage: ComposedWorldUsage | null = null;
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

  const publishBoardChanged = revisionPublisher(
    "world_board_changed",
    "world-board",
  );
  const { boardElements, bindBoardRecipients } = composeBoardData({
    board,
    publish: publishBoardChanged,
    sources: () => ({ connectionManager, coreControl: coreRpc }),
  });
  const worldCli = createWorldCliService({
    elements: boardElements,
    memory: () => rpcServices.worldMemory!,
    core: () => coreCallers,
    board,
    ledger: () => storage.ledger(),
    attention: () => storage.attention(),
    effects: () => storage.effects(),
    clock,
    scheduler,
    now: () => clock.now(),
    incarnation: storage.incarnation,
    connections: () => connectionManager,
    snapshots: () => worldSnapshots,
    sources: async () => worldSources.current(),
    usage: async (params) => {
      if (!worldUsage) throw new Error("Usage analytics is unavailable");
      return worldUsage.analytics.get(params);
    },
    townMoveQueues,
    publishBoard: publishBoardChanged,
    broadcast: (line) => broadcast(line, "world-ledger"),
  });
  const { core, rpc: coreRpc } = composeCore({
    logger: logger.child("connections"),
    changed: publishConnectionsChanged,
    observed: publishWorldInvalidation,
    profiles: () => connectionProfiles,
    topology: storage.coreTopology,
    // Its pages are always this service's sockets.
    sendToPage: (ws, line) =>
      safeSend(ws as ServerWebSocket<unknown>, line, "core-terminal"),
    push: (task, isCurrent) => webPush.notify(task, isCurrent),
    readSettings: () => settings.read(),
  });
  const coreCallers = coreCallerSource(() => coreRpc);
  /** The agent bin: reversible holding, a scheduled bus, then a durable fenced close. */
  const bin = createBinService({
    core: () => core.manager, // herdr-core closes are native kills
    incarnation: serviceIncarnation,
    clock,
    scheduler,
    ledger: () => storage.ledger(),
    outbox: () => storage.attention(),
    effects: () => storage.effects(),
    connections: () => connectionManager,
    publish: revisionPublisher("world_bin_changed", "world-bin"),
    log: (message) => logger.warn(message),
    retiring: (entries) => apartments.apartments.retire(entries),
  });
  void bin.start();
  /** Apartments: the records finished agents leave (shared/apartments.ts). */
  const apartments = createApartmentsService({
    port: storage.apartments,
    now: () => clock.now(),
    tui: () => connectionManager,
    core: () => coreRpc,
    sources: () => worldSources.current(),
    board,
    profiles: () => storage.profiles(),
    publish: revisionPublisher("world_apartments_changed", "world-apartments"),
    log: (message) => logger.warn(message),
  });
  const {
    observe: observeHost,
    retire: retireTerminalMarks,
    close: closeTerminalMarks,
    ...terminalMarks
  } = createSharedTerminalMarks({
    scheduler,
    storage: storage.terminalMarks,
    incarnation: serviceIncarnation,
    publisher: revisionPublisher,
    broadcast: (line) => broadcast(line, "world-desk"),
    lease: (connectionId) => connectionManager.readyRuntimeLease(connectionId),
    now: () => clock.now(),
    invalidate: publishWorldInvalidation,
    logger,
    stop: () => (stopTask ??= stopService()),
  });

  function publishWorldInvalidation(
    connectionId: string,
    connectionGeneration: number,
    kind?: "late" | "activity",
  ) {
    if (kind !== "late" && kind !== "activity")
      worldUsage?.activity.invalidate(connectionId, clock.now());
    const revision = worldSnapshots?.invalidate(connectionId, kind);
    if (revision === undefined) return;
    const line = serializeWorldInvalidation(
      connectionId,
      connectionGeneration,
      revision,
      observedConnections,
    );
    broadcast(line, "world-invalidation");
  }

  const connectionFailureReporter = connectionFailureReporters(
    logger.child("connections"),
  );
  const connectionManager = new ConnectionManager<LegacyConnectionRuntime>(
    connectionBootstrap.defaultConnectionId,
    (status) => {
      worldUsage?.connectionStatus(status);
      focusedAcquisition.reconcile();
      deskWatches.reconcile();
      publishConnectionsChanged();
      retireTerminalMarks(
        status.id,
        status.generation,
        status.state === "ready",
        !["error", "disconnected"].includes(status.state),
      );
      bin.connectionStatus(status);
      apartments.apartments.connectionStatus(status);
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
  const observedConnections = worldRuntimeRegistry(
    connectionManager,
    core.manager,
    () => connectionProfiles.hosts.list(),
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
    observedConnections,
    () => clock.now(),
    (connectionId, generation) =>
      publishWorldInvalidation(connectionId, generation, "late"),
    undefined,
    () => terminalMarks.worldWatchlist.list(),
    apartments.fresh((id, generation, panes, at, agents) => {
      if (connectionManager.has(id))
        observeHost(id, generation, panes, at, agents);
      worldUsage?.activity.observeFresh(id, generation, panes, at, agents);
    }),
    apartments.complete(ownedBy(connectionManager, observeTerminalSettings)),
    serviceIncarnation,
  );

  const assistantContext = createRuntimeAssistantContext({
    profiles: () => [
      ...connectionProfiles.list(),
      ...connectionProfiles.coreList(),
    ],
    tui: connectionManager,
    core: coreRpc,
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
    profile: TuiConnectionProfile | StartupLocalProfile,
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
          clock,
          scheduler,
          identity,
          connectionGeneration: context.generation,
          config: profileConfig,
          settings,
          runtimeStatus: storage.runtimeStatus,
          forwards: forwards.registry,
          logger: logger.child("connection"),
          safeSend,
          broadcast,
          clientLabel,
          markRpcError,
          taskNotificationSource: config.taskNotificationSource,
          onTaskEvent: (event) =>
            webPush.notify(
              connectionTaskPush(
                event,
                identity.id,
                context.generation,
                [
                  ...connectionProfiles.list(),
                  ...connectionProfiles.coreList(),
                ],
                identity.label,
              ),
              context.isCurrent,
            ),
          onEvent: (event, eventIdentity, kind) => {
            if (!context.isCurrent()) return;
            publishWorldInvalidation(
              eventIdentity.id,
              context.generation,
              kind,
            );
            afterHerdrClose(
              board(),
              eventIdentity.id,
              herdrEventName(event),
              event,
              {
                call: (rpc, rpcParams) =>
                  runtime.tui.call(rpc, rpcParams, 10_000),
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
    core: core.support,
    store: storage.connections,
    changed: publishConnectionsChanged,
    bootstrap: connectionBootstrap,
    discoverHost: deps.adapters.herdr.discoverHost,
    createRuntime: runtimeFactoryForProfile,
    // The setup card's lookup; a ready implicit local server is Herdr (#935).
    noHerdrTui: () =>
      findHerdrBinary() === null &&
      !(
        connectionManager.has(STARTUP_DEFAULT_CONNECTION_ID) &&
        connectionManager.status(STARTUP_DEFAULT_CONNECTION_ID).state ===
          "ready"
      ),
    retry: {
      schedule: (callback, delayMs) => scheduler.schedule(callback, delayMs),
    },
  });

  const worldSources = await composeSources({
    settings,
    paths,
    storageOpen: () => storageOpen,
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
    hostOf: (connectionId) => {
      if (connectionId === STARTUP_DEFAULT_CONNECTION_ID && config.sshHost)
        return { kind: "ssh", destination: config.sshHost };
      const profile = connectionProfiles
        .list()
        .find((entry) => entry.id === connectionId);
      if (profile?.type === "local") return { kind: "local" };
      if (profile?.type === "ssh" && profile.remote_platform !== "windows")
        return { kind: "ssh", destination: profile.ssh_destination };
      return null;
    },
    now: () => clock.now(),
  });
  const handleWorldSources = withIntegrations(worldSources, {
    profiles: connectionProfiles,
    metrics: officeObservability,
    vaultPath: paths.sourceSecrets,
    now: () => clock.now(),
  });
  const shipyardInstances = new ShipyardInstances(
    paths.instanceRegistry,
    paths.root,
    () => clock.now(),
    scheduler,
  );
  const shipyardIdentity = await shipyardInstanceIdentity(
    serviceIncarnation,
    config.appVersion,
    clock.now(),
  );
  const shipyard = new ShipyardService({
    run: runSourceProcess,
    source: () => worldSources.shipyardSource(),
    instances: () => shipyardInstances.read(),
    now: () => clock.now(),
  });
  const shipyardHttp = createShipyardHttp(shipyard);

  worldUsage = composeWorldUsage({
    connectionManager,
    core,
    coreRpc,
    connectionProfiles,
    observedConnections,
    worldSnapshots,
    worldSources,
    settings,
    officeObservability,
    clock,
    scheduler,
    serviceIncarnation,
    config,
    dataRoot: paths.root,
  });
  const rpcServices: RpcServices = {
    clock,
    bindings: storage.bindings,
    serviceIncarnation,
    bindBoardRecipients,
    board,
    clients,
    connectionManager,
    connectionProfiles,
    core,
    coreControl: coreRpc,
    coreInstall: createCoreInstall({
      profiles: () => connectionProfiles,
      fixture: core.fixture,
    }),
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
    uiSettings: createUiSettingsRpcHandler({
      readSettings: () => settings.read(),
      updateSettings: (update, shouldCommit) =>
        settings.update(update, shouldCommit),
    }),
    ...terminalMarks,
    bin,
    apartments,
    worldCli,
    worldSnapshots,
    worldUsage,
    boardElements,
    worldUsageAnalytics: worldUsage.analytics,
    worldMemory: createRuntimeMemoryService({
      tui: () => connectionManager,
      core: coreRpc,
      now: () => clock.now(),
    }),
  };
  const handleRpc = createRpcDispatcher(rpcServices, legacyRoutingLogger);

  const { track, drained } = inFlightWork(scheduler, (requests) =>
    logger.warn("World stopped with requests still running", { requests }),
  );

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
            core: coreRpc,
            legacyRoutingLogger,
            snapshotAdmission,
            handleRpc,
            webPush,
            worldCli,
            connectionCli: {
              profiles: connectionProfiles,
              registryPath: paths.connections,
              snapshot: () => worldSnapshots!.snapshot(),
            },
            settings,
            update,
            herdrSetup,
            officeObservability: handleOfficeObservability,
            sources: handleWorldSources,
            weatherCli: weatherCliHandler(worldSources),
            shipyard: { service: shipyard, http: shipyardHttp },
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
      publishInstanceAddress(releaseDataFolder, config, server);
      shipyardInstances.start(
        shipyardIdentity,
        server.port ?? config.port,
        config.host,
        !!config.tls,
      );
      worldCli.start();
      forwards.listeningOn(server.port ?? config.port);
      return {
        port: server.port ?? config.port,
        connected: startTask!.catch(() => {}),
      };
    },
    /** Drain/release once, listener last. keepListener binds until process exit:
     * launchd waits for the port to free before restarting (service-manager.ts).
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
    await sweepOrphanedSshMasters();
    if (stopping) return;
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
    // Refuse requests (503), reconnects, pushes, Ranger starts and new answer waits.
    stopping = true;
    worldSources.weather.close();
    shipyard.close();
    shipyardInstances.stop();
    const usageStopped = worldUsage!.close();
    focusedAcquisition.stop();
    deskWatches.stop();
    connectionProfiles.stopSupervision();
    webPush.stop();
    await worldCli.stop();
    await bin.stop();
    // Drop browser sockets as a process exit does; pages reconnect.
    for (const ws of [...browsers.clients]) ws.terminate();
    try {
      // Stop Ranger then runtimes, failing pending Herdr calls; fenced startup/requests settle.
      await forwards.stop();
      await disposeAssistant();
      await connectionManager.stopAll();
      await core.stop();
      await usageStopped;
      await startTask?.catch(() => {});
      await disposeAssistant();
      await drained();
    } finally {
      try {
        // Finished agents seen so far are written before storage closes;
        // a history census still reading stops.
        await apartments.stop();
        await closeTerminalMarks();
        storageOpen = false;
        await storage.close();
      } finally {
        releaseDataFolder();
      }
    }
  }
}
