/** Town renderer counters for development tools and browser tests (townRenderer.ts). */
import type { ViewTrace } from "../devtools/flag";
import { worldRendererCountersEnabled } from "../devtools/renderer";
import type { TownLevel } from "./townCamera";

/** Why Town drew a frame and what it asked for next (development trace). */
export type TownFrameTrace = {
  reasons: string[];
  next: "state" | "motion" | null;
  /** What keeps a state frame coming: the camera, actors, a drag… */
  causes: string[];
};

export type TownRendererDiagnostics = {
  /** Town's event trace, so a fixture can read gestures without its overlay. */
  trace?: ViewTrace;
  mounts: number;
  destroys: number;
  activeApplications: number;
  activeTickers: number;
  frames: number;
  sceneRenders: number;
  /** Single buildings baked again after their colours, pins or desks changed. */
  buildingBakes: number;
  /** Navigation grids built (unchanged buildings keep theirs). */
  navigationsBuilt: number;
  /** Agents reconciled by actor syncs (unchanged hosts are skipped). */
  actorsReconciled: number;
  /** Actor syncs per host: how often each host's agents were reconciled. */
  hostSyncs: Record<string, number>;
  ready: boolean;
  reducedMotion: boolean;
  interactionPaused: boolean;
  lastError: string | null;
  level: TownLevel | null;
  zoom: number;
  /** True until the current camera flight reaches its target. */
  flying: boolean;
  actors: number;
  walking: number;
  /** Agents opened by the user whose goal is their own desk. */
  summoned: string[];
  desks: number;
  /** Animated node counts, kept compatible with existing browser evidence. */
  animation: {
    characters: number;
    monitors: number;
    statuses: number;
  };
  layout: null | {
    width: number;
    height: number;
    buildings: number;
    rooms: number;
    /** The container shape: stacked buildings, room and desk columns. */
    formFactor: string;
    roomColumns: number;
    deskColumns: number;
    /** Room and building placement (townGeometryKey), to see reflows. */
    geometry: string;
  };
  /** Drag outcomes as drawn: lifts, landings (each with its dust), returns. */
  drags: { lifts: number; landings: number; returns: number; dust: number };
};

declare global {
  interface Window {
    __HERDR_WORLD_FORCE_RENDERER_FAILURE__?: boolean;
    __HERDR_TOWN_RENDERER__?: TownRendererDiagnostics;
  }
}

/** The renderer's counters, shared on `window` when counters are enabled. */
export function diagnostics(): TownRendererDiagnostics {
  const enabled = worldRendererCountersEnabled();
  if (enabled && window.__HERDR_TOWN_RENDERER__)
    return window.__HERDR_TOWN_RENDERER__;
  const value: TownRendererDiagnostics = {
    mounts: 0,
    destroys: 0,
    activeApplications: 0,
    activeTickers: 0,
    frames: 0,
    sceneRenders: 0,
    buildingBakes: 0,
    navigationsBuilt: 0,
    actorsReconciled: 0,
    hostSyncs: {},
    ready: false,
    reducedMotion: false,
    interactionPaused: false,
    lastError: null,
    level: null,
    zoom: 1,
    flying: false,
    actors: 0,
    walking: 0,
    summoned: [],
    desks: 0,
    animation: { characters: 0, monitors: 0, statuses: 0 },
    layout: null,
    drags: { lifts: 0, landings: 0, returns: 0, dust: 0 },
  };
  if (enabled) window.__HERDR_TOWN_RENDERER__ = value;
  return value;
}
