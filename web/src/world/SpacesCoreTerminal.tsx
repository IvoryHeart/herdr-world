import { Cpu, X } from "lucide-react";
import { AgentIcon } from "../components/AgentIcon";
import { AgentMark } from "../components/AgentMark";
import { agentMarkKind } from "./agentMarks";
import { coreInspectorTerminal } from "./coreInspectorTerminal";
import { type SpacesCoreChoice, spacesCoreLeaf } from "./spacesCore";
import type { WorldObject } from "./worldObject";
import "./spacesCoreTerminal.css";

/**
 * A live herdr-core terminal in Spaces' terminal area, in place of a Herdr
 * TUI tab: Spaces' tab bar and panes belong to the Herdr TUI, so the watched
 * terminal World's window shows fills Spaces instead. Its bar names the
 * agent, its place and runtime; Close returns to the Herdr TUI tab.
 */
export function SpacesCoreTerminal({
  world,
  choice,
  onClose,
}: {
  world: Pick<WorldObject, "nodeById">;
  choice: SpacesCoreChoice;
  onClose(): void;
}) {
  const leaf = spacesCoreLeaf(world, choice);
  const room = leaf ? world.nodeById.get(leaf.parentId) : undefined;
  const place = leaf
    ? [leaf.hostLabel, room?.label, leaf.tabLabel].filter(Boolean).join(" › ")
    : null;
  const mark = leaf?.kind === "agent" ? agentMarkKind(leaf.status) : null;
  return (
    <section
      className="spaces-core"
      aria-label={`${leaf?.label ?? choice.label} on herdr-core`}
      data-spaces-core={choice.nodeId}
    >
      <header className="spaces-core-bar">
        <span className="spaces-core-icon" aria-hidden="true">
          {leaf?.kind === "agent" ? (
            <AgentIcon agent={leaf.pane.agent} compact />
          ) : (
            <Cpu size={14} />
          )}
        </span>
        <strong className="spaces-core-name">
          {leaf?.label ?? choice.label}
        </strong>
        {place ? <span className="spaces-core-place">{place}</span> : null}
        <span className="spaces-core-runtime" title="herdr-core">
          <Cpu size={13} aria-hidden="true" />
          herdr-core
        </span>
        {mark ? <AgentMark kind={mark} /> : null}
        <button
          type="button"
          className="spaces-core-close"
          aria-label="Close herdr-core terminal"
          title="Close herdr-core terminal"
          onClick={onClose}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </header>
      <div className="spaces-core-body">
        {coreInspectorTerminal(leaf, { selected: true, shown: true }) ?? (
          <div className="core-watch-ended" role="status">
            <p>
              {choice.label} is no longer where World last saw it on herdr-core.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
