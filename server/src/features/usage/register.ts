import { defineFeature, featureKey } from "../contract";
import type { ComposedWorldUsage } from "../../service/usage-analytics";
import { usageRpc } from "./rpc";
import { usageVerbs } from "./verbs";

export const usageKey = featureKey<ComposedWorldUsage>("usage");
export const feature = defineFeature({
  id: usageKey,
  capability: "world-usage",
  requires: [],
  verbs: usageVerbs,
  create(kernel) {
    const usage = kernel.createUsage({
      ...kernel,
      ...kernel.observations,
      connectionManager: kernel.connections(),
      core: { manager: kernel.core() },
      coreRpc: { host: kernel.coreHost, git: kernel.coreGit },
      connectionProfiles: kernel.profiles,
      worldSources: kernel.sources(),
      dataRoot: kernel.paths.root,
    });
    return {
      api: usage,
      rpc: usageRpc(usage),
      connectionStatus: (status) => usage.connectionStatus(status),
      stop: { quiesce: () => usage.close() },
    };
  },
});
