import { Suspense, useEffect, useMemo, useState } from "react";
import { lazyWithReload } from "../../lazyWithReload";
import type { FeatureSlotProps } from "../../features/FeatureHosts";
import { requestArtefactFile } from "../artefactOpen";
import type { WorldObject } from "../worldObject";
import type { ArtefactRoute } from "./LibraryArtefacts";
import { type MemoryLibraryRequest, WORLD_MEMORY_EVENT } from "./memoryEvents";
import { libraryAvailable, useMemoryHostPublisher } from "./memoryTargets";

const MemoryLibrary = lazyWithReload("world-memory", () =>
  import("./MemoryLibrary").then((module) => ({
    default: module.MemoryLibrary,
  })),
);

/**
 * How the Library reaches a made file (#1327) through World's live agents
 * on its host: its maker while it runs (else an agent in its room, else
 * any) reads it and, in its Inspector's Files, opens it.
 */
function artefactRoute(
  world: Pick<WorldObject, "leaves">,
  onOpen: FeatureSlotProps["dialogs"]["onOpen"],
  onOpened: () => void,
): ArtefactRoute {
  const agents = (connectionId: string) =>
    world.leaves.filter(
      (leaf) =>
        leaf.kind === "agent" &&
        !leaf.stale &&
        leaf.connectionId === connectionId,
    );
  const via = (artefact: Parameters<ArtefactRoute["workspace"]>[0]) => {
    const live = agents(artefact.made_by.connection_id);
    const maker = artefact.gone_maker
      ? undefined
      : live.find(
          (leaf) =>
            (leaf.pane.pane_id ?? leaf.terminalId) === artefact.made_by.pane_id,
        );
    const room = live.find(
      (leaf) => leaf.workspaceId === artefact.made_by.workspace_id,
    );
    return [maker, room, ...live].filter((leaf) => leaf !== undefined);
  };
  return {
    workspace: (artefact) => via(artefact)[0]?.workspaceId ?? null,
    openInFiles(artefact) {
      if (artefact.where.type !== "file") return null;
      const path = artefact.where.path;
      const leaf = via(artefact).find((one) => one.capabilities.files);
      if (!leaf) return null;
      return () => {
        requestArtefactFile(leaf.id, path);
        onOpen({
          connectionId: leaf.connectionId,
          runtimeGeneration: leaf.generation,
          terminalId: leaf.terminalId,
        });
        onOpened();
      };
    },
  };
}

/**
 * Mounted once by FeatureHosts, whichever view is open: publishes the
 * hosts the Library may read and opens it on WORLD_MEMORY_EVENT.
 */
export function MemoryLibraryHost({
  world,
  onOpen,
}: FeatureSlotProps["dialogs"]) {
  const [request, setRequest] = useState<MemoryLibraryRequest | null>(null);
  useMemoryHostPublisher(world);
  useEffect(() => {
    const onOpenLibrary = (event: Event) => {
      const next = { ...(event as CustomEvent<MemoryLibraryRequest>).detail };
      if (libraryAvailable(world, next)) setRequest(next);
    };
    window.addEventListener(WORLD_MEMORY_EVENT, onOpenLibrary);
    return () => window.removeEventListener(WORLD_MEMORY_EVENT, onOpenLibrary);
  }, [world]);
  const route = useMemo(
    () => artefactRoute(world, onOpen, () => setRequest(null)),
    [world, onOpen],
  );
  if (!request) return null;
  return (
    <Suspense fallback={null}>
      <MemoryLibrary
        key={JSON.stringify(request)}
        request={request}
        route={route}
        onClose={() => setRequest(null)}
      />
    </Suspense>
  );
}
