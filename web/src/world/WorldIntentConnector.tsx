import { useLayoutEffect, useRef } from "react";
import type { WorldAnchorFeed } from "./worldAnchorFeed";
import {
  type WorldConnectorTargetBounds,
  worldConnectorPath,
  worldConnectorTargetPoint,
} from "./worldConnectorGeometry";

/**
 * The line from a node's anchor in the view to its Inspector window. The
 * anchor moves with the view's frames, so the line follows the feed in place
 * rather than through React.
 */
export default function WorldIntentConnector({
  feed,
  nodeId,
  target,
}: {
  feed: WorldAnchorFeed;
  nodeId: string;
  target: WorldConnectorTargetBounds;
}) {
  const path = useRef<SVGPathElement | null>(null);
  const from = useRef<SVGCircleElement | null>(null);
  const to = useRef<SVGCircleElement | null>(null);
  useLayoutEffect(() => {
    const targetPoint = worldConnectorTargetPoint(target);
    const draw = () => {
      const source = feed.get()?.[nodeId];
      if (!source || !path.current || !from.current || !to.current) return;
      path.current.setAttribute("d", worldConnectorPath(source, targetPoint));
      from.current.setAttribute("cx", String(source.x));
      from.current.setAttribute("cy", String(source.y));
      to.current.setAttribute("cx", String(targetPoint.x));
      to.current.setAttribute("cy", String(targetPoint.y));
    };
    draw();
    return feed.subscribe(draw);
  }, [feed, nodeId, target]);
  return (
    <svg className="world-intent-connector" aria-hidden="true">
      <path ref={path} />
      <circle ref={from} r="3" />
      <circle ref={to} r="3" />
    </svg>
  );
}
