import { Package } from "lucide-react";
import type { AgentArtefact } from "../../../shared/agentArtefacts";
import { useAgentDeskReads } from "./agentQuests";
import { openMemoryLibrary } from "./memory/memoryEvents";
import { madeSummary } from "./memory/artefactShelfModel";
import type { WorldLeafObject } from "./worldObject";
import "./madeSummary.css";

/** What each agent made, by leaf ID: the same desk read Town uses. */
export function useAgentArtefacts(leaves: readonly WorldLeafObject[]) {
  return useAgentDeskReads(leaves).artefacts;
}

/** A Desk row's "N made", or null when the agent made nothing. */
export function artefactsMade(items: readonly AgentArtefact[] | undefined) {
  return items?.length ? `${items.length} made` : null;
}

/** Opens the Library's "Made by agents" wing on this agent (#1327). */
function openMadeBy(leaf: WorldLeafObject) {
  openMemoryLibrary({
    connectionId: leaf.connectionId,
    agentId: leaf.pane.pane_id ?? leaf.terminalId,
    wing: "artefacts",
  });
}

/**
 * An agent's short "Made" summary on its Desk card, Town peek and Chat: how
 * many things it made and the latest one or two. It only points into the
 * Library, which is where they are listed, searched and read.
 */
export function MadeSummary({
  leaf,
  items,
}: {
  leaf: WorldLeafObject;
  items?: readonly AgentArtefact[] | null;
}) {
  const summary = madeSummary(items);
  if (!summary) return null;
  const more = summary.count - summary.latest.length;
  return (
    <button
      type="button"
      className="made-summary"
      title="Open what it made in the Library"
      onClick={(event) => {
        event.stopPropagation();
        openMadeBy(leaf);
      }}
    >
      <Package size={13} aria-hidden="true" />
      <span className="made-summary-head">Made {summary.count}</span>
      <span className="made-summary-latest">
        {summary.latest.join(", ")}
        {more > 0 ? ` +${more}` : ""}
      </span>
    </button>
  );
}
