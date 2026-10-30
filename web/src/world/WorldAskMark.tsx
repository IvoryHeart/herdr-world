import type { WorldAsk } from "./worldAsks";
import "../components/AgentMark.css";
import "./worldAsks.css";

/** The same quiet question mark in Board and Desk; the enclosing agent still opens normally. */
export function WorldAskMark({ ask }: { ask?: WorldAsk }) {
  if (!ask) return null;
  return (
    <span
      className="agent-mark world-ask-mark"
      data-mark="asks"
      data-world-ask={ask.id}
      title={`Owner question: ${ask.question}`}
      aria-label={`Owner question: ${ask.question}`}
    >
      ?
    </span>
  );
}
