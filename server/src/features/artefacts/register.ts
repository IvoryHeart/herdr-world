import { apartmentsKey } from "../apartments/register";
import { defineFeature, featureKey } from "../contract";
// Type only: the service passes the factory in through the kernel, so the
// feature catalog (loaded by the storage worker) stays free of runtime code.
import type { ArtefactShelfService } from "../../world/artefact-shelf";
import { artefactsVerbs } from "./verbs";

/** A host's rooms (workspace ID and label), read once per shelf read. */
async function roomsOf(operations: {
  listWorkspaces(
    params: Record<string, never>,
    options: { timeoutMs: number },
  ): Promise<{ workspaces?: readonly Record<string, unknown>[] }>;
}) {
  const { workspaces = [] } = await operations.listWorkspaces(
    {},
    { timeoutMs: 5000 },
  );
  // Labelled as Apartments records them: trimmed, at most 200 characters.
  return workspaces.flatMap((row) => {
    const label =
      typeof row.label === "string" ? row.label.trim().slice(0, 200) : "";
    return typeof row.workspace_id === "string" && label
      ? [{ workspace_id: row.workspace_id, label }]
      : [];
  });
}

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
    const shelf = kernel.createArtefactShelf({
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
            rooms: () => roomsOf(lease.runtime.operations),
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
          rooms: () => roomsOf(kernel.coreHostRuntime(lease).operations),
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
