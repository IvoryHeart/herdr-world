import type { OfficeCanvasAnchor } from "./PixelOfficeCanvas";
import {
  type WorldConnectorTargetBounds,
  worldConnectorPath,
  worldConnectorTargetPoint,
} from "./worldConnectorGeometry";

export default function WorldIntentConnector({
  source,
  target,
}: {
  source: OfficeCanvasAnchor;
  target: WorldConnectorTargetBounds;
}) {
  const targetPoint = worldConnectorTargetPoint(target);
  const path = worldConnectorPath(source, targetPoint);
  return (
    <svg className="world-intent-connector" aria-hidden="true">
      <path d={path} />
      <circle cx={source.x} cy={source.y} r="3" />
      <circle cx={targetPoint.x} cy={targetPoint.y} r="3" />
    </svg>
  );
}
