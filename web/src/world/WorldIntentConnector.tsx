import type { OfficeCanvasAnchor } from "./PixelOfficeCanvas";

export default function WorldIntentConnector({
  source,
  target,
}: {
  source: OfficeCanvasAnchor;
  target: { x: number; y: number };
}) {
  const distance = Math.max(48, Math.min(180, (target.x - source.x) * 0.45));
  const path = `M ${source.x} ${source.y} C ${source.x + distance} ${source.y}, ${target.x - distance} ${target.y}, ${target.x} ${target.y}`;
  return (
    <svg className="world-intent-connector" aria-hidden="true">
      <path d={path} />
      <circle cx={source.x} cy={source.y} r="3" />
      <circle cx={target.x} cy={target.y} r="3" />
    </svg>
  );
}
