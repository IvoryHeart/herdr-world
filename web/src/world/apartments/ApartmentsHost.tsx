import { useEffect, useState } from "react";
import type { WorldObject } from "../worldObject";
import { ApartmentsDialog } from "./ApartmentsDialog";
import type { ApartmentsRequest } from "./apartmentsStore";
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
  const [open, setOpen] = useState<ApartmentsRequest | null>(null);
  useEffect(() => {
    const onApartments = (event: Event) =>
      setOpen({
        ...(event as CustomEvent<ApartmentsRequest | undefined>).detail,
      });
    window.addEventListener(WORLD_APARTMENTS_EVENT, onApartments);
    return () =>
      window.removeEventListener(WORLD_APARTMENTS_EVENT, onApartments);
  }, []);
  return open ? (
    <ApartmentsDialog
      key={JSON.stringify(open)}
      world={world}
      initialQuery={open.query}
      initialResident={open.resident}
      onOpen={onOpen}
      onClose={() => setOpen(null)}
    />
  ) : null;
}
