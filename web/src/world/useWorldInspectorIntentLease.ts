import { useEffect } from "react";
import type { ConnectionSummary } from "../api";
import type { WorldObjectNode } from "./worldObject";
import { ownerReady } from "./worldInspectorSelection";

/** Snapshot staleness is not a user selection or a runtime retirement. */
export function useWorldInspectorIntentLease(
  selected: WorldObjectNode | null,
  connections: readonly ConnectionSummary[],
  intentRequestRef: { current: number },
  setIntentOpening: (opening: boolean) => void,
) {
  const selectedLeaseCurrent = ownerReady(selected, { connections });
  useEffect(() => {
    if (selected && !selectedLeaseCurrent) {
      intentRequestRef.current += 1;
      setIntentOpening(false);
    }
  }, [selectedLeaseCurrent, selected, intentRequestRef, setIntentOpening]);
}
