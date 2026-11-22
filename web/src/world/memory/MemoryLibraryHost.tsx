import { Suspense, useEffect, useState } from "react";
import { lazyWithReload } from "../../lazyWithReload";
import type { WorldObject } from "../worldObject";
import { type MemoryLibraryRequest, WORLD_MEMORY_EVENT } from "./memoryEvents";
import { libraryAvailable, useMemoryHostPublisher } from "./memoryTargets";

const MemoryLibrary = lazyWithReload("world-memory", () =>
  import("./MemoryLibrary").then((module) => ({
    default: module.MemoryLibrary,
  })),
);

/**
 * Mounted once by FeatureHosts, whichever view is open: publishes the
 * hosts the Library may read and opens it on WORLD_MEMORY_EVENT.
 */
export function MemoryLibraryHost({ world }: { world: WorldObject }) {
  const [request, setRequest] = useState<MemoryLibraryRequest | null>(null);
  useMemoryHostPublisher(world);
  useEffect(() => {
    const onOpen = (event: Event) => {
      const next = { ...(event as CustomEvent<MemoryLibraryRequest>).detail };
      if (libraryAvailable(world, next)) setRequest(next);
    };
    window.addEventListener(WORLD_MEMORY_EVENT, onOpen);
    return () => window.removeEventListener(WORLD_MEMORY_EVENT, onOpen);
  }, [world]);
  if (!request) return null;
  return (
    <Suspense fallback={null}>
      <MemoryLibrary
        key={JSON.stringify(request)}
        request={request}
        onClose={() => setRequest(null)}
      />
    </Suspense>
  );
}
