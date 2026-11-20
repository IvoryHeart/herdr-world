import { Suspense, useEffect, useState } from "react";
import { lazyWithReload } from "../../lazyWithReload";
import type { WorldObject } from "../worldObject";
import { type MemoryLibraryRequest, WORLD_MEMORY_EVENT } from "./memoryEvents";
import { useMemoryHostPublisher } from "./memoryTargets";

const MemoryLibrary = lazyWithReload("world-memory", () =>
  import("./MemoryLibrary").then((module) => ({
    default: module.MemoryLibrary,
  })),
);

/**
 * Mounted once by the control plane, whichever view is open: publishes the
 * hosts the Library may read and opens it on WORLD_MEMORY_EVENT.
 */
export function MemoryLibraryHost({ world }: { world: WorldObject }) {
  const [request, setRequest] = useState<MemoryLibraryRequest | null>(null);
  useMemoryHostPublisher(world);
  useEffect(() => {
    const onOpen = (event: Event) =>
      setRequest({ ...(event as CustomEvent<MemoryLibraryRequest>).detail });
    window.addEventListener(WORLD_MEMORY_EVENT, onOpen);
    return () => window.removeEventListener(WORLD_MEMORY_EVENT, onOpen);
  }, []);
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
