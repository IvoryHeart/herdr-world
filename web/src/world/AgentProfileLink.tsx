import { openProfileEditor, useAgentProfiles } from "./agentProfiles";
import { profileLinkFor } from "./profileLink";

/**
 * The agent-settings popover's way to its profile: Edit profile when the
 * agent was launched from one (one assignment per terminal), else Profiles.
 */
export function AgentProfileLink({
  connectionId,
  terminalId,
}: {
  connectionId: string;
  terminalId?: string;
}) {
  const { document } = useAgentProfiles();
  const link = profileLinkFor(document, connectionId, terminalId);
  return (
    <button
      type="button"
      className="workspace-inspector-agent-settings-link"
      onClick={() => openProfileEditor(link.profileId)}
    >
      {link.label}
    </button>
  );
}
