import { useCallback, useSyncExternalStore } from "react";
import {
  sameCanvasAnchors,
  type WorldCanvasAnchor,
} from "./worldConnectorGeometry";

type Anchors = Readonly<Record<string, WorldCanvasAnchor>> | null;

/**
 * The views' conversation anchors, outside React state. A view reports them
 * after every render and drawn frame; a walking agent or a moving camera
 * changes them each frame, so subscribers move connectors in place, and React
 * learns only whether a node has an anchor (useWorldAnchorPresent).
 */
export type WorldAnchorFeed = {
  get(): Anchors;
  /** Keep the current anchors when `next` is structurally the same. */
  set(next: Anchors): void;
  subscribe(listener: () => void): () => void;
};

export function createWorldAnchorFeed(): WorldAnchorFeed {
  let anchors: Anchors = null;
  const listeners = new Set<() => void>();
  return {
    get: () => anchors,
    set(next) {
      if (sameCanvasAnchors(anchors, next)) return;
      anchors = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Whether `nodeId` has an anchor: commits only when that changes. */
export function useWorldAnchorPresent(feed: WorldAnchorFeed, nodeId: string) {
  const present = useCallback(
    () => Boolean(feed.get()?.[nodeId]),
    [feed, nodeId],
  );
  return useSyncExternalStore(feed.subscribe, present, present);
}
