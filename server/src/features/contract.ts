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
    logger: RpcServices["logger"];
    clients: Pick<RpcServices["clients"], "has">;
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
    sources(): Awaited<ReturnType<typeof composeSources>>;
    board: WorldStorage["board"];
  }
>;

export function featureKernel(
  deps: WorldServiceDeps,
  storage: WorldStorage,
  rpc: RpcServices,
  sources: FeatureKernel["sources"],
): FeatureKernel {
  return Object.freeze({
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
