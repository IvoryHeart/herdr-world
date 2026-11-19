import { type AgentProfile, launchPlan } from "../../../shared/agentProfile";
import type { LaunchRequest } from "./launch";
import { claudeTapArgs, type ClaudeTapRuntime } from "../usage/claude-tap";

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

/**
 * Add the status line tap (usage/claude-tap.ts) to a Claude launch, so World
 * reads that agent's subscription limits. Only this launch gets it; the
 * user's settings files stay untouched. Without a runtime for the tap on the
 * agent's host, the launch is unchanged and so is the user's status line.
 */
export function withClaudeLimitsTap<
  T extends Pick<LaunchRequest, "kind" | "args">,
>(
  launch: T,
  runtime: ClaudeTapRuntime | null,
): Omit<T, "args"> & Pick<LaunchRequest, "args"> {
  if (launch.kind !== "claude" || !runtime) return launch;
  const args = launch.args;
  return {
    ...launch,
    args: (name: string) => [
      ...(typeof args === "function" ? args(name) : (args ?? [])),
      ...claudeTapArgs(runtime),
    ],
  };
}
