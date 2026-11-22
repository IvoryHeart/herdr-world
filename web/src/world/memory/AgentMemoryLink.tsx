import { memoryHarness } from "../../../../shared/memory";
import { memoryFixtureOn, memoryFixtureHasMemory } from "./memoryFixture";
import { openMemoryLibrary } from "./memoryEvents";

/**
 * The agent-settings popover's way to the Library (#1027), on this agent:
 * what it would load at start, and its files to read or edit.
 */
export function AgentMemoryLink({
  connectionId,
  agentId,
  harness,
}: {
  connectionId: string;
  /** The agent's pane ID, the memory service's agent ID. */
  agentId?: string;
  harness?: string;
}) {
  if (
    !memoryHarness(harness) ||
    (memoryFixtureOn() && !memoryFixtureHasMemory())
  )
    return null;
  return (
    <button
      type="button"
      className="workspace-inspector-agent-settings-link"
      onClick={() => openMemoryLibrary({ connectionId, agentId })}
    >
      Memory
    </button>
  );
}
