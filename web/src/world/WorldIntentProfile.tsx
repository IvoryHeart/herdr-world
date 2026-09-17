import { useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { AgentIcon } from "../components/AgentIcon";
import type { WorldObjectNode } from "./worldObject";

export default function WorldIntentProfile({
  node,
  currentGeneration,
  inspectorOpen,
  intentOpening,
  resourceError,
  onActivateHost,
  onClose,
  onOpenSpaces,
}: {
  node: WorldObjectNode;
  currentGeneration: boolean;
  inspectorOpen: boolean;
  intentOpening: boolean;
  resourceError: string | null;
  onActivateHost(): Promise<void>;
  onClose(): void;
  onOpenSpaces(): Promise<void>;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leaf = node.kind === "agent" || node.kind === "terminal" ? node : null;
  const hasWorkspace = node.kind !== "host";
  const disabled = !currentGeneration || working;
  const stateLabel = !currentGeneration
    ? "Stale"
    : leaf?.kind === "agent"
      ? (leaf.stateLabels[leaf.status] ?? leaf.status)
      : hostStateLabel(node.hostState);

  async function run(action: () => Promise<void>, requiresActionable = true) {
    if (disabled || (requiresActionable && !node.actionable)) return;
    setWorking(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking(false);
    }
  }

  return (
    <aside
      className="world-selection-panel world-intent-profile"
      aria-label="World selection"
      data-kind={node.kind}
    >
      <header className="world-intent-profile-header">
        <span className="world-intent-avatar" aria-hidden="true">
          {node.kind === "agent" ? (
            <AgentIcon agent={node.pane.agent} compact />
          ) : node.kind === "terminal" ? (
            ">_"
          ) : node.kind === "space" ? (
            "S"
          ) : (
            "H"
          )}
        </span>
        <div className="world-intent-identity">
          <p className="world-eyebrow">
            {node.kind} · {stateLabel}
          </p>
          <h2>{node.label}</h2>
          <p className="world-intent-context">
            {leaf ? `${leaf.spaceLabel} · ` : ""}
            {node.hostLabel}
          </p>
        </div>
        <div className="world-intent-header-actions">
          {hasWorkspace && currentGeneration && node.capabilities.openSpaces ? (
            <button
              type="button"
              disabled={disabled}
              title="Open in Spaces"
              aria-label="Open in Spaces"
              onClick={() => void run(onOpenSpaces)}
            >
              <ExternalLink size={15} />
            </button>
          ) : null}
          <button
            className="world-panel-close"
            type="button"
            onClick={onClose}
            title="Close profile"
            aria-label="Close profile"
          >
            <X size={16} />
          </button>
        </div>
      </header>
      {leaf?.taskSummary ? (
        <section className="world-task-summary" aria-label="Current task">
          <span>Current task</span>
          <p>{leaf.taskSummary}</p>
        </section>
      ) : null}
      {currentGeneration && node.capabilities.activateHost ? (
        <div className="world-panel-actions">
          <button
            type="button"
            disabled={working}
            onClick={() => void run(onActivateHost, false)}
          >
            Activate {node.hostLabel}
          </button>
        </div>
      ) : null}
      {!currentGeneration || !node.actionable ? (
        <p className="world-panel-warning">
          {!currentGeneration
            ? "This selection belongs to a retired runtime generation. Select its current observation to use operational tools."
            : node.capabilities.activateHost
              ? `This observation is read-only. Activate ${node.hostLabel} to use its operational tools.`
              : "This observation is read-only until its host is ready again."}
        </p>
      ) : null}
      {intentOpening ? (
        <p className="world-intent-loading" role="status">
          Opening intent…
        </p>
      ) : null}
      {!intentOpening && hasWorkspace && node.actionable && !inspectorOpen ? (
        <p className="world-intent-loading" role="status">
          Resource view closed. Select this entity again to reopen it.
        </p>
      ) : null}
      {error || resourceError ? (
        <p className="world-panel-error" role="alert">
          {error ?? resourceError}
        </p>
      ) : null}
    </aside>
  );
}

function hostStateLabel(state: WorldObjectNode["hostState"]) {
  switch (state) {
    case "active":
      return "Active";
    case "ready-inactive":
      return "Ready · inactive";
    case "reconnecting":
      return "Reconnecting";
    case "offline-stale":
      return "Offline · stale";
  }
}
