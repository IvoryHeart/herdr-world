import type { OfficeCallout } from "./officeSelection";

export function OfficeCanvasCallout({
  callout,
  left,
  top,
  persistent = false,
}: {
  callout: OfficeCallout | null;
  left: number;
  top: number;
  persistent?: boolean;
}) {
  if (!callout) return null;
  return (
    <div
      className={`world-canvas-callout${persistent ? " world-canvas-callout-persistent" : ""}`}
      data-kind={callout.kind}
      data-status={callout.status ?? undefined}
      style={{ left, top }}
      role={persistent ? "status" : "tooltip"}
      aria-live={persistent ? "polite" : undefined}
    >
      <strong>{callout.title}</strong>
      {callout.summary ? (
        <span className="world-canvas-callout-summary">{callout.summary}</span>
      ) : null}
      <span>{callout.detail}</span>
    </div>
  );
}
