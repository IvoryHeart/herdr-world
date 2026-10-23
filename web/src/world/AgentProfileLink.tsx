import { openProfileEditor, useAgentProfiles } from "./agentProfiles";

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
  const assignment = terminalId
    ? document?.assignments.find(
        (a) => a.connection_id === connectionId && a.terminal_id === terminalId,
      )
    : undefined;
  const profile = assignment
    ? document?.profiles.find((p) => p.id === assignment.profile_id)
    : undefined;
  return (
    <button
      type="button"
      className="workspace-inspector-agent-settings-link"
      onClick={() => openProfileEditor(profile?.id)}
    >
      {profile ? `Edit profile · ${profile.name}` : "Profiles…"}
    </button>
  );
}
