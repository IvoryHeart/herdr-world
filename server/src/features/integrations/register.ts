import type { createIntegrations } from "./service";
import { defineFeature, featureKey } from "../contract";
import { integrationsVerbs } from "./verbs";

export const integrationsKey =
  featureKey<ReturnType<typeof createIntegrations>>("integrations");
export const feature = defineFeature({
  id: integrationsKey,
  capability: "world-surfaces/integrations",
  requires: [],
  verbs: integrationsVerbs,
  create(kernel) {
    const integrations = kernel.createIntegrations(kernel.sources(), {
      profiles: kernel.profiles,
      metrics: kernel.observations.officeObservability,
      vaultPath: kernel.paths.sourceSecrets,
      now: () => kernel.clock.now(),
    });
    return {
      api: integrations,
      rpc: Object.fromEntries(
        integrationsVerbs.map(({ name }) => [
          name,
          (rpc) => integrations.rpc(rpc),
        ]),
      ),
      // Stateless projections/installers: in-flight requests drain with the root.
    };
  },
});
