import { defineFeature, featureKey } from "../contract";
import type { ApartmentsService } from "./service";
import { handleApartmentsRpc } from "./rpc";
import { apartmentsVerbs } from "./verbs";

export const apartmentsKey = featureKey<ApartmentsService>("apartments");
export const feature = defineFeature({
  id: apartmentsKey,
  capability: "world-surfaces/apartments",
  requires: [],
  verbs: apartmentsVerbs,
  create(kernel) {
    const apartments = kernel.createApartments({
      port: kernel.storage.apartments,
      now: () => kernel.clock.now(),
      tui: kernel.connections,
      core: () => ({
        manager: kernel.core(),
        hostRuntime: kernel.coreApartmentRuntime,
      }),
      sources: () => kernel.sources().current(),
      board: kernel.board,
      profiles: kernel.storage.profiles,
      publish: kernel.revisionPublisher(
        "world_apartments_changed",
        "world-apartments",
      ),
      log: (message) => kernel.logger.warn(message),
    });
    return {
      api: apartments,
      rpc: Object.fromEntries(
        apartmentsVerbs.map(({ name }) => [
          name,
          (rpc) => handleApartmentsRpc(rpc, apartments),
        ]),
      ),
      connectionStatus: (status) =>
        apartments.apartments.connectionStatus(status),
      stop: { close: () => apartments.stop() },
    };
  },
});
