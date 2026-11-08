import type { AgentContextFill } from "../world/agentContextFill";
import "./ContextFillBar.css";

/**
 * A slim needs bar for how full an agent's context is. `inline` shows the
 * percent beside the bar, with the full reading as its tooltip; `edge` sits
 * under an agent's icon, whose own label carries the reading.
 */
export function ContextFillBar({
  fill,
  variant,
}: {
  fill: AgentContextFill;
  variant: "inline" | "edge";
}) {
  const level = fill.tired ? "tired" : fill.percent >= 70 ? "low" : "ok";
  if (variant === "edge")
    return (
      <span
        className="context-fill context-fill-edge"
        data-level={level}
        aria-hidden="true"
      >
        <i style={{ width: `${fill.percent}%` }} />
      </span>
    );
  return (
    <span
      className="context-fill context-fill-inline"
      data-level={level}
      role="img"
      aria-label={fill.text}
      title={fill.text}
    >
      <span className="context-fill-track" aria-hidden="true">
        <i style={{ width: `${fill.percent}%` }} />
      </span>
      <span aria-hidden="true">{fill.percent}%</span>
    </span>
  );
}
