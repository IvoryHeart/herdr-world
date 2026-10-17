/*
 * MODIFIED FILE NOTICE — Apache-2.0 Section 4(b)
 *
 * This TypeScript drawing adaptation is downstream Herdr World / Office work
 * derived from the historical Claw-Empire Office renderer. Source provenance,
 * source hashes, and license obligations are recorded in docs/world-assets.md.
 */

import { Container, Graphics } from "pixi.js";
import type { HerdrOfficeProjection } from "./herdrOfficeProjection";
import type {
  OfficeLongRoomTitleMode,
  OfficeRoomAlignment,
} from "./officeGeometry";
import type { PublishedOfficeLayout } from "./officeLayout";
import type { OfficeObservability } from "./officeObservability";
import type { OfficeCreationActionState } from "./officeRoomActions";

export type AnimatedItem =
  | { kind: "character"; node: Container; baseY: number; phase: number }
  | {
      kind: "monitor" | "status";
      node: Container | Graphics;
      baseAlpha: number;
      phase: number;
    };

export type OfficeRendererDiagnostics = {
  mounts: number;
  destroys: number;
  activeApplications: number;
  activeTickers: number;
  activeObservers: number;
  activeListeners: number;
  canvases: number;
  frames: number;
  sceneRenders: number;
  sceneSkips: number;
  layerBuilds: number;
  layerReuses: number;
  ready: boolean;
  reducedMotion: boolean;
  interactionPaused: boolean;
  lastError: string | null;
  animation: {
    characters: number;
    monitors: number;
    statuses: number;
  };
  layout: null | {
    officeWidth: number;
    totalHeight: number;
    rooms: number;
    characterHeight: number;
    ceoBandHeight: number;
    viewportHeight: number;
  };
  /** Browser-test and observability hook for the immutable layout consumed by both presenters. */
  publishedLayout: PublishedOfficeLayout | null;
  completionMarkers: number;
};

export type OfficeRendererController = {
  update: (
    projection: HerdrOfficeProjection,
    selectedKey: string | null,
    completionSeenKeys?: ReadonlySet<string>,
    observability?: OfficeObservability,
    roomAlignment?: OfficeRoomAlignment,
    longRoomTitleMode?: OfficeLongRoomTitleMode,
    seatCreationStates?: Readonly<Record<string, OfficeCreationActionState>>,
  ) => Promise<void>;
  getAnchors: (
    selectedKey: string | null,
    conversationTargetKey: string | null,
  ) => OfficeRendererAnchors;
  destroy: () => void;
};

export type OfficeRendererAnchor = {
  x: number;
  y: number;
};

export type OfficeCanvasHover = {
  key: string;
  clientX: number;
  clientY: number;
};

export type OfficeRendererAnchors = {
  agent: OfficeRendererAnchor | null;
  workbench: OfficeRendererAnchor | null;
};

declare global {
  interface Window {
    __HERDR_WORLD_FORCE_RENDERER_FAILURE__?: boolean;
    __HERDR_WORLD_RENDERER__?: OfficeRendererDiagnostics;
  }
}
