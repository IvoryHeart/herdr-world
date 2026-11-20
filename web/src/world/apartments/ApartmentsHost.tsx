import { useEffect, useState } from "react";
import type { WorldObject } from "../worldObject";
import { ApartmentsDialog } from "./ApartmentsDialog";
import { WORLD_APARTMENTS_EVENT } from "./useApartments";

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
    <ApartmentsDialog
      world={world}
      initialQuery={open.query}
      onOpen={onOpen}
      onClose={() => setOpen(null)}
    />
  ) : null;
}
