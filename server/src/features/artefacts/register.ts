import { apartmentsKey } from "../apartments/register";
import { defineFeature, featureKey } from "../contract";
import {
  createArtefactShelf,
  type ArtefactShelfService,
} from "../../world/artefact-shelf";
import { artefactsVerbs } from "./verbs";

export const artefactsKey = featureKey<ArtefactShelfService>("artefacts");

/**
 * What agents made (#1327), for the Library: each read names one host by
 * its immutable connection and the generation the browser observed, and is
 * refused for any other; it never falls back to another connection.
 */
export const feature = defineFeature({
  id: artefactsKey,
  capability: "world-artefacts",
  requires: [apartmentsKey],
  verbs: artefactsVerbs,
  create(kernel, get) {
    const apartments = get(apartmentsKey).apartments;
    const shelf = createArtefactShelf({
      now: () => kernel.clock.now(),
      residents: () =>
        apartments.available ? apartments.list().residents : [],
      host(connectionId, generation) {
        const tui = kernel.connections();
        if (tui.has(connectionId)) {
          const lease = tui.readyRuntimeLease(connectionId);
          if (!lease || lease.generation !== generation || !lease.isCurrent())
            return null;
          const sessions = lease.runtime.agentSessions;
          return {
            quests: () => sessions.conversation.quests(),
            files: lease.runtime.agentSessionFiles,
          };
        }
        const core = kernel.core();
        if (!core.has(connectionId)) return null;
        const lease = core.readyRuntimeLease(connectionId);
        if (!lease || lease.generation !== generation || !lease.isCurrent())
          return null;
        const host = kernel.coreApartmentRuntime(lease);
        return {
          quests: () => host.agentSessions().conversation.quests(),
          files: host.agentSessionFiles,
        };
      },
    });
    return {
      api: shelf,
      rpc: {
        "world.artefacts.list": async ({
          id,
          params,
          sendReply,
          sendError,
        }) => {
          try {
            const p = (params ?? {}) as Record<string, unknown>;
            const connection = p.connection_id;
            const generation = p.connection_generation;
            if (
              typeof connection !== "string" ||
              !connection ||
              typeof generation !== "number" ||
              !Number.isSafeInteger(generation) ||
              generation < 0
            )
              throw new Error(
                "A connection_id and its observed connection_generation are required",
              );
            sendReply(
              { id, result: await shelf.list(connection, generation) },
              "world-artefacts",
            );
          } catch (error) {
            sendError("world-artefacts-error", error);
          }
        },
      },
    };
  },
});
