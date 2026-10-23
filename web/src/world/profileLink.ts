import type { ProfilesDocument } from "./agentProfiles";

/**
 * The profile an agent was launched from (one assignment per terminal), as
 * the agent-settings link shows it: Edit profile · <name>, else Profiles….
 */
export function profileLinkFor(
  document: Pick<ProfilesDocument, "assignments" | "profiles"> | null,
  connectionId: string,
  terminalId: string | undefined,
): { profileId?: string; label: string } {
  const assignment = terminalId
    ? document?.assignments.find(
        (a) => a.connection_id === connectionId && a.terminal_id === terminalId,
      )
    : undefined;
  const profile = assignment
    ? document?.profiles.find((p) => p.id === assignment.profile_id)
    : undefined;
  return profile
    ? { profileId: profile.id, label: `Edit profile · ${profile.name}` }
    : { label: "Profiles…" };
}
