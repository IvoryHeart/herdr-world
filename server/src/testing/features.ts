import { composeWorldUsage } from "../service/usage-analytics";
import { composeFeatures } from "../features/compose";
import type { FeatureKernel } from "../features/contract";
import type { RpcServices } from "../rpc/context";

export const testFeatureKernel = (ports: Partial<FeatureKernel> = {}) =>
  ({
    createUsage: composeWorldUsage,
    paths: { root: "/dev/null" },
    connections: () => undefined,
    core: () => undefined,
    sources: () => undefined,
    ...ports,
  }) as FeatureKernel;

/** Give hand-built dispatcher fixtures the same discovered handlers as production. */
export function withFeatures(services: RpcServices): RpcServices {
  const kernel = testFeatureKernel({
    clients: services.clients,
    clock: services.clock,
    connections: () => services.connectionManager,
    core: () => services.core?.manager as ReturnType<FeatureKernel["core"]>,
    coreHostRuntime: (lease) => services.coreControl!.hostRuntime(lease),
  });
  const features = composeFeatures(kernel);
  return { ...services, featureRpc: features.rpc };
}
