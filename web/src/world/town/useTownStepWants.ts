/**
 * Town's side of the thought bubbles (TownStepBubble): names the agents
 * whose steps it wants (working agents at desks on screen at the room and
 * desk levels), and redraws when an agent's bubble comes or goes, so the
 * renderer drops or restores its typing dots.
 */

import { useEffect, useRef } from "react";
import type { TownCamera, TownLevel } from "./townCamera";
import type { TownLayout } from "./townLayout";
import type { TownModel } from "./townModel";
import type { TownRendererHandle } from "./townRenderer";
import { townStepWanted, type TownStepStore } from "./townStepStore";

export type { TownStepStore };

const NO_KEYS: ReadonlySet<string> = new Set();

export function useTownStepWants(
  steps: TownStepStore | undefined,
  /** The town now: read when a frame is drawn, never during render. */
  town: () => {
    model: TownModel;
    layout: TownLayout;
    askingKeys: ReadonlySet<string>;
  },
  renderer: { readonly current: TownRendererHandle | null },
) {
  // A bubble that comes or goes takes or gives back the typing dots: the
  // renderer reads them each frame (TownStepStore.hasGlyph), so it only needs
  // a frame, not a React render.
  useEffect(
    () => steps?.onGlyphs(() => renderer.current?.invalidate("step-bubbles")),
    [steps, renderer],
  );
  const view = useRef({
    key: "",
    model: null as TownModel | null,
    asking: NO_KEYS,
  });
  /**
   * Asked again on drawn frames when the camera has moved a little, the
   * level changed, or the town's agents did.
   */
  const want = (camera: TownCamera, level: TownLevel) => {
    if (!steps) return;
    const { model, layout, askingKeys: asking } = town();
    const near = level === "room" || level === "desk";
    const from = camera.toWorld(0, 0);
    const to = camera.toWorld(camera.viewport.width, camera.viewport.height);
    const key = near
      ? [from.x, from.y, to.x, to.y]
          .map((value) => Math.round(value / 32))
          .join()
      : level;
    const last = view.current;
    if (last.key === key && last.model === model && last.asking === asking)
      return;
    view.current = { key, model, asking };
    steps.want(
      near
        ? townStepWanted(
            layout.buildings.flatMap((building) => building.rooms),
            { x0: from.x, y0: from.y, x1: to.x, y1: to.y },
            (deskKey) =>
              (model.desks.get(deskKey)?.paneDevices ?? []).flatMap((device) =>
                device.agentKey ? [device.agentKey] : [],
              ),
            (agentKey) =>
              model.agents.get(agentKey)?.semanticStatus === "working" &&
              !asking.has(agentKey),
          )
        : [],
    );
  };
  // The town's agents can change without a frame drawn.
  useEffect(() => {
    const current = renderer.current;
    if (current) want(current.camera, current.level);
  });
  return { want };
}
