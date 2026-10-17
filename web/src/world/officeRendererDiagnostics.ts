/*
 * MODIFIED FILE NOTICE — Apache-2.0 Section 4(b)
 *
 * This TypeScript drawing adaptation is downstream Herdr World / Office work
 * derived from the historical Claw-Empire Office renderer. Source provenance,
 * source hashes, and license obligations are recorded in docs/world-assets.md.
 */

import { worldRendererCountersEnabled } from "./worldRendererDebug";
import { type OfficeRendererDiagnostics } from "./officeRendererTypes";

export function ensureDiagnostics(): OfficeRendererDiagnostics {
  const enabled = worldRendererCountersEnabled();
  if (enabled && window.__HERDR_WORLD_RENDERER__)
    return window.__HERDR_WORLD_RENDERER__;
  const diagnostics: OfficeRendererDiagnostics = {
    mounts: 0,
    destroys: 0,
    activeApplications: 0,
    activeTickers: 0,
    activeObservers: 0,
    activeListeners: 0,
    canvases: 0,
    frames: 0,
    sceneRenders: 0,
    sceneSkips: 0,
    layerBuilds: 0,
    layerReuses: 0,
    ready: false,
    reducedMotion: false,
    interactionPaused: false,
    lastError: null,
    animation: { characters: 0, monitors: 0, statuses: 0 },
    layout: null,
    publishedLayout: null,
    completionMarkers: 0,
  };
  if (enabled) window.__HERDR_WORLD_RENDERER__ = diagnostics;
  return diagnostics;
}
