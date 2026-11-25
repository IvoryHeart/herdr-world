import { createProfileServices } from "../features/appearance/service";
import { createDesk } from "../features/desk/service";
import { composeWorldUsage } from "../service/usage-analytics";
import { createApartmentsService } from "../features/apartments/service";
import { createArtefactShelf } from "../world/artefact-shelf";
import { composeFeatures } from "../features/compose";
import type { FeatureKernel } from "../features/contract";
import type { RpcServices } from "../rpc/context";

export const testFeatureKernel = (ports: Partial<FeatureKernel> = {}) => {
  const kernel = {
    send: () => true,
    deskMarks: () => ({}),
    appearanceRpc: {} as FeatureKernel["appearanceRpc"],
    createAppearance: createProfileServices,
    createUsage: composeWorldUsage,
    createApartments: createApartmentsService,
    createArtefactShelf,
    clock: { now: () => 0, monotonic: () => 0 },
    storage: {},
    revisionPublisher: () => () => {},
    logger: { warn() {} },
    paths: { root: "/dev/null" },
    connections: () => undefined,
    core: () => undefined,
    sources: () => undefined,
    ...ports,
  } as FeatureKernel;
  return { ...kernel, desk: ports.desk ?? createDesk(kernel) };
};

/** Give hand-built dispatcher fixtures the same discovered handlers as production. */
export function withFeatures(services: RpcServices): RpcServices {
  const kernel = testFeatureKernel({
    clients: services.clients,
    send: services.safeSend,
    deskMarks: () => ({ persistentMarks: services.persistentMarks }),
    appearanceRpc: {
      coreControl: services.coreControl,
      board: services.board,
      publishBoardChanged: services.publishBoardChanged,
      publishWorldInvalidation: services.publishWorldInvalidation,
    },
    ...(services.clock ? { clock: services.clock } : {}),
    connections: () => services.connectionManager,
    core: () => services.core?.manager as ReturnType<FeatureKernel["core"]>,
    coreHostRuntime: (lease) => services.coreControl!.hostRuntime(lease),
    coreApartmentRuntime: (lease) => services.coreControl!.hostRuntime(lease),
  });
  const features = composeFeatures(kernel);
  return { ...services, featureRpc: features.rpc };
}
