import { type AgentProfile, launchPlan } from "../../../shared/agentProfile";
import type { LaunchRequest } from "./launch";

/**
 * What one launch from the dialog asks of the launcher: a profile (or a
 * quick pick of a kind), the tab's label and the first prompt the user saw.
 * A plain kind receives the profile's role ahead of that prompt, so the role
 * reaches it even when no brief is sent.
 */
export function profileLaunch(
  profile: AgentProfile | null,
  choice: { kind: string; label: string; text: string },
): Pick<LaunchRequest, "kind" | "label" | "args" | "text"> {
  if (!profile)
    return { kind: choice.kind, label: choice.label, text: choice.text };
  const label = choice.label || profile.name;
  return {
    kind: profile.harness,
    label,
    args: (name) => launchPlan(profile, name).args,
    text: [launchPlan(profile, "").preamble, choice.text.trim()]
      .filter(Boolean)
      .join("\n\n"),
  };
}
