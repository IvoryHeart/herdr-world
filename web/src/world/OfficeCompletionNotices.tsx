import type { OfficeAgent } from "./herdrOfficeProjection";

const MAX_VISIBLE_COMPLETIONS = 8;

export function OfficeCompletionNotices({
  agents,
  onInspect,
}: {
  agents: readonly OfficeAgent[];
  onInspect(agent: OfficeAgent): void;
}) {
  if (!agents.length) return null;
  const visible = agents.slice(0, MAX_VISIBLE_COMPLETIONS);
  return (
    <section
      className="world-completion-notices"
      aria-label="Unseen agent completions"
      aria-live="polite"
    >
      {visible.map((agent) => (
        <button
          key={`${agent.observedGeneration}:${agent.key}`}
          type="button"
          disabled={!agent.canOpenInSpaces}
          title={
            agent.canOpenInSpaces
              ? `Inspect ${agent.displayLabel} completion`
              : `${agent.displayLabel} completion is unavailable until its host is active`
          }
          onClick={() => onInspect(agent)}
        >
          <strong>{agent.displayLabel} completed</strong>
          <span>{agent.taskSummary ?? "Inspect terminal"}</span>
        </button>
      ))}
      {agents.length > visible.length ? (
        <span>+{agents.length - visible.length} more completions</span>
      ) : null}
    </section>
  );
}
