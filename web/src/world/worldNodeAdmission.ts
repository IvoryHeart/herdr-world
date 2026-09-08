import type { BridgeRuntime } from "../bridge";
import { runtimeAdmissionReady } from "../runtimeClient";
import type { RuntimeLoadState } from "../runtimeClient";
import type { PaneInfo, Snapshot } from "../types";
import type { HerdrGraphProjection, WorldGraphNode } from "./graph/herdrGraphProjection";
import type { OfficeHandoffRequest } from "./herdrOfficeHandoff";

export type WorldNodeAdmissionState = {
  connectionKey: string;
  snapshot: Snapshot | null;
  loadState: RuntimeLoadState;
};

export type AdmittedWorldTerminal = {
  node: WorldGraphNode;
  runtime: BridgeRuntime;
  pane: PaneInfo;
};

export type AdmittedWorldSpace = {
  node: WorldGraphNode;
  handoff: OfficeHandoffRequest;
};

/** Revalidates a rendered Graph/Tree space before using its current Spaces handoff. */
export function admitCurrentWorldSpace(
  rendered: WorldGraphNode,
  projection: HerdrGraphProjection,
): AdmittedWorldSpace | null {
  if (rendered.kind !== "space" || !rendered.actionable || !rendered.handoff) return null;
  const latest = projection.nodes.find(({ id }) => id === rendered.id);
  if (
    latest?.kind !== "space" ||
    !latest.actionable ||
    !latest.handoff ||
    latest.parentId !== rendered.parentId ||
    latest.hostKey !== rendered.hostKey ||
    latest.selectionKey !== rendered.selectionKey ||
    latest.observedGeneration !== rendered.observedGeneration
  ) return null;
  return { node: latest, handoff: latest.handoff };
}

/** Revalidates a rendered Graph/Tree leaf against current qualified runtime state. */
export function admitCurrentWorldTerminal(
  rendered: WorldGraphNode,
  projection: HerdrGraphProjection,
  runtime: BridgeRuntime | null,
  state: WorldNodeAdmissionState | null | undefined,
): AdmittedWorldTerminal | null {
  if ((rendered.kind !== "terminal" && rendered.kind !== "agent") || !rendered.paneId) return null;
  const latest = projection.nodes.find(({ id }) => id === rendered.id);
  const pane = state?.snapshot?.panes.find(({ pane_id }) => pane_id === rendered.paneId) ?? null;
  if (
    (latest?.kind !== "terminal" && latest?.kind !== "agent") ||
    latest.hostKey !== rendered.hostKey ||
    latest.paneId !== rendered.paneId ||
    latest.selectionKey !== rendered.selectionKey ||
    latest.observedGeneration !== rendered.observedGeneration ||
    !runtime ||
    runtime.id !== rendered.hostKey ||
    runtime.generationKey !== rendered.observedGeneration ||
    !pane ||
    !runtimeAdmissionReady(runtime, state, ["snapshot", "terminal_attach"])
  ) return null;
  return { node: latest, runtime, pane };
}
