import { composeFeatures } from "../features/compose";
import type { FeatureKernel } from "../features/contract";
import type { RpcServices } from "../rpc/context";

/** Give hand-built dispatcher fixtures the same discovered handlers as production. */
export function withFeatures(services: RpcServices): RpcServices {
  const kernel: Partial<FeatureKernel> = {
    clients: services.clients,
    clock: services.clock,
    connections: () => services.connectionManager,
    core: () => services.core!.manager,
    coreHostRuntime: (lease) => services.coreControl!.hostRuntime(lease),
  };
  const features = composeFeatures(kernel as FeatureKernel);
  return { ...services, featureRpc: features.rpc };
}
