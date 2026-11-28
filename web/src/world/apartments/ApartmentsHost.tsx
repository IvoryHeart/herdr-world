import { Suspense, useEffect, useState } from "react";
import { lazyWithReload } from "../../lazyWithReload";
import type { WorldObject } from "../worldObject";
import { WORLD_APARTMENTS_EVENT } from "./useApartments";

// The dialog (and the agent history it shows) loads when it first opens, not
// with Town's first frame (#1479).
const ApartmentsDialog = lazyWithReload("world-apartments", () =>
  import("./ApartmentsDialog").then((module) => ({
    default: module.ApartmentsDialog,
  })),
);

/** Apartments, opened from any view by `openApartments()`. */
export function ApartmentsHost({
  world,
  onOpen,
}: {
  world: WorldObject;
  onOpen(terminal: {
    connectionId: string;
    runtimeGeneration: number;
    terminalId: string;
  }): void;
}) {
  const [open, setOpen] = useState<{ query: string } | null>(null);
  useEffect(() => {
    const onApartments = (event: Event) =>
      setOpen({
        query: (event as CustomEvent<string | undefined>).detail ?? "",
      });
    window.addEventListener(WORLD_APARTMENTS_EVENT, onApartments);
    return () =>
      window.removeEventListener(WORLD_APARTMENTS_EVENT, onApartments);
  }, []);
  return open ? (
    <Suspense fallback={null}>
      <ApartmentsDialog
        world={world}
        initialQuery={open.query}
        onOpen={onOpen}
        onClose={() => setOpen(null)}
      />
    </Suspense>
  ) : null;
}
