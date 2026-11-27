import { defineFeature, featureKey } from "../contract";
import type { createProfileServices } from "./service";
import { handleAppearanceRpc } from "./rpc";
import { appearanceVerbs } from "./verbs";

export const appearanceKey =
  featureKey<ReturnType<typeof createProfileServices>>("appearance");
export const feature = defineFeature({
  id: appearanceKey,
  capability: "world-surfaces/appearance",
  requires: [],
  verbs: appearanceVerbs,
  create(kernel) {
    // Profiles stay World's; per-terminal settings live in Herdr pane metadata.
    const appearance = kernel.createAppearance(
      kernel.revisionPublisher,
      kernel.connections,
      kernel.storage.profiles,
      () => kernel.clock.now(),
    );
    const services = {
      ...kernel.appearanceRpc,
      connectionManager: kernel.connections(),
    };
    return {
      api: appearance,
      rpc: Object.fromEntries(
        appearanceVerbs.map(({ name }) => [
          name,
          (rpc) => handleAppearanceRpc({ ...rpc, services }),
        ]),
      ),
      // Lazy services have no background resources; writes drain with the root.
    };
  },
});
