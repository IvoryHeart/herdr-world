import type { ConnectionManager } from "../connections/manager";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import type { CoreConnectionRuntime } from "../herdr-core/runtime";
import type { ConnectionStatus } from "../connections/types";
import type { ConnectionRuntime } from "../connections/manager";
import type { BridgeRpcContext, RpcServices } from "../rpc/context";
import type { WorldServiceDeps } from "../service/ports";
import type { WorldStorage } from "../service/storage";
import type { composeSources } from "../sources/composition";
import { createRevisionPublisher } from "../world/revision-publisher";
import type { Verb } from "../verbs/types";

type Connections<T extends ConnectionRuntime> = Pick<
  ConnectionManager<T>,
  "list" | "has" | "status" | "readyRuntimeLease"
>;
/** Ports only: no listener, shutdown, authentication or default runtime authority. */
export type FeatureKernel = Readonly<
  Pick<WorldServiceDeps, "clock" | "scheduler"> & {
    desk: ReturnType<typeof import("./desk/service").createDesk>;
    send: RpcServices["safeSend"];
    deskMarks(): Pick<RpcServices, "persistentMarks">;
    appearanceRpc: Pick<
      RpcServices,
      "board" | "publishBoardChanged" | "publishWorldInvalidation"
    >;
    createAppearance: typeof import("./appearance/service").createProfileServices;
    createIntegrations: typeof import("./integrations/service").createIntegrations;
    createUsage: typeof import("../service/usage-analytics").composeWorldUsage;
    createApartments: typeof import("./apartments/service").createApartmentsService;
    createArtefactShelf: typeof import("../world/artefact-shelf").createArtefactShelf;
    paths: Pick<WorldServiceDeps["paths"], "root" | "sourceSecrets">;
    config: Pick<WorldServiceDeps["config"], "sshHost">;
    serviceIncarnation: string;
    profiles: Pick<RpcServices["connectionProfiles"], "list" | "coreList"> &
      Partial<Pick<RpcServices["connectionProfiles"], "hosts">>;
    coreHost: import("../rpc/core").CoreRpcServices["host"];
    observations: {
      observedConnections: {
        list(): import("../world/runtime-registry").WorldRuntimeStatus[];
      };
      worldSnapshots: NonNullable<RpcServices["worldSnapshots"]>;
      officeObservability: Pick<
        import("../world/observability").OfficeObservabilityService,
        "snapshot" | "configuration"
      >;
    };
    logger: RpcServices["logger"];
    clients: Pick<RpcServices["clients"], "has" | typeof Symbol.iterator>;
    settings: WorldStorage["settings"];
    storage: Readonly<
      Omit<
        WorldStorage,
        "close" | "failed" | "settings" | "connections" | "board"
      >
    >;
    revisionPublisher: ReturnType<typeof createRevisionPublisher>;
    connections(): Connections<LegacyConnectionRuntime>;
    core(): Connections<CoreConnectionRuntime>;
    coreHostRuntime: (
      ...args: Parameters<import("../rpc/core").CoreRpcServices["hostRuntime"]>
    ) => import("../memory/service").MemoryLease["runtime"];
    coreApartmentRuntime: (
      ...args: Parameters<import("../rpc/core").CoreRpcServices["hostRuntime"]>
    ) => Pick<
      import("../herdr-core/host-runtime").CoreHostRuntime,
      "agentSessionFiles" | "agentSessions"
    >;
    coreGit: (
      ...args: Parameters<import("../rpc/core").CoreRpcServices["hostRuntime"]>
    ) => import("../herdr-core/host-runtime").CoreHostRuntime["worktreeGit"];
    sources(): Awaited<ReturnType<typeof composeSources>>;
    board: WorldStorage["board"];
  }
>;

export function featureKernel(
  deps: WorldServiceDeps,
  storage: WorldStorage,
  rpc: RpcServices,
  sources: FeatureKernel["sources"],
  observations: FeatureKernel["observations"],
  createUsage: FeatureKernel["createUsage"],
  createApartments: FeatureKernel["createApartments"],
  desk: FeatureKernel["desk"],
  createAppearance: FeatureKernel["createAppearance"],
  createArtefactShelf: FeatureKernel["createArtefactShelf"],
  createIntegrations: FeatureKernel["createIntegrations"],
): FeatureKernel {
  return Object.freeze({
    createIntegrations,
    createAppearance,
    desk,
    send: rpc.safeSend,
    deskMarks: () => ({ persistentMarks: rpc.persistentMarks }),
    appearanceRpc: {
      board: rpc.board,
      publishBoardChanged: rpc.publishBoardChanged,
      publishWorldInvalidation: rpc.publishWorldInvalidation,
    },
    createUsage,
    createApartments,
    createArtefactShelf,
    paths: deps.paths,
    config: deps.config,
    serviceIncarnation: rpc.serviceIncarnation!,
    profiles: rpc.connectionProfiles,
    coreHost: (id) => rpc.coreControl!.host(id),
    observations,
    clock: deps.clock,
    scheduler: deps.scheduler,
    logger: rpc.logger,
    clients: rpc.clients,
    settings: storage.settings,
    storage,
    board: () => storage.board(),
    revisionPublisher: createRevisionPublisher(rpc.clients, rpc.safeSend),
    connections: () => rpc.connectionManager,
    core: () => rpc.core!.manager,
    coreHostRuntime: (lease) => rpc.coreControl!.hostRuntime(lease),
    coreApartmentRuntime: (lease) => rpc.coreControl!.hostRuntime(lease),
    coreGit: (lease) => rpc.coreControl!.hostRuntime(lease).worktreeGit,
    sources,
  });
}

declare const dependencyType: unique symbol;
export type FeatureKey<T> = string & { readonly [dependencyType]: T };
export const featureKey = <T>(id: string) => id as FeatureKey<T>;
export type FeatureRpcHandler = (
  rpc: Omit<BridgeRpcContext, "services">,
) => void | Promise<void>;
export type StopPhase = "quiesce" | "drain" | "close";
export type FeatureInstance<T = unknown> = {
  api: T;
  rpc: Readonly<Record<string, FeatureRpcHandler>>;
  acquisition?: import("../service/clients").SocketOwner & {
    reconcile(): void;
    stop(): void;
  };
  connectionStatus?(status: ConnectionStatus): void;
  listening?(port: number): void;
  stop?: Partial<Record<StopPhase, () => void | Promise<void>>>;
};
export type Feature<T = unknown> = {
  id: FeatureKey<T>;
  capability: string;
  requires: readonly FeatureKey<unknown>[];
  verbs: readonly Verb[];
  create(
    kernel: FeatureKernel,
    get: <D>(key: FeatureKey<D>) => D,
  ): FeatureInstance<T>;
};
export const defineFeature = <T>(feature: Feature<T>): Feature<T> =>
  Object.freeze(feature);
