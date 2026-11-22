import type { MemoryService } from "../../memory/service";
import { defineFeature, featureKey } from "../contract";
import { handleMemoryRpc } from "./rpc";
import { createRuntimeMemoryService } from "./runtime-service";
import { memoryVerbs } from "./verbs";

export const memoryKey = featureKey<MemoryService>("memory");
export const feature = defineFeature({
  id: memoryKey,
  capability: "world-memory",
  requires: [],
  verbs: memoryVerbs,
  create(kernel) {
    const memory = createRuntimeMemoryService(kernel);
    return {
      api: memory,
      rpc: Object.fromEntries(
        memoryVerbs
          .filter((verb) => verb.channel === "rpc")
          .map((verb) => [
            verb.name,
            (rpc) => handleMemoryRpc(rpc, memory, kernel.clients),
          ]),
      ),
      // No background work or close hook: in-flight calls drain with the root.
    };
  },
});
