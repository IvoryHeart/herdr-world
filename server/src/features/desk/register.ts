import { defineFeature, featureKey } from "../contract";
import type { createDesk } from "./service";
import { handleDeskRpc } from "./rpc";
import { deskVerbs } from "./verbs";

export const deskKey = featureKey<ReturnType<typeof createDesk>>("desk");
export const feature = defineFeature({
  id: deskKey,
  capability: "world-surfaces/desk-attention",
  requires: [],
  verbs: deskVerbs,
  create(kernel) {
    const desk = kernel.desk;
    const services = {
      worldDesk: desk.service.registry,
      publishDeskChanged: desk.service.publish,
      deskWatches: desk.watches,
      connectionManager: kernel.connections(),
      get persistentMarks() {
        return kernel.deskMarks().persistentMarks;
      },
    };
    return {
      api: desk,
      acquisition: desk.watches,
      rpc: Object.fromEntries(
        deskVerbs.map(({ name }) => [
          name,
          (rpc) => handleDeskRpc({ ...rpc, services }),
        ]),
      ),
    };
  },
});
