import type { Pane } from "../types";
import { store } from "../store";
import { setAgentInterest, useAgentInterest } from "../world/useAgentInterest";
import { InterestButton, type InterestChoice } from "./InterestButton";

/** Shared choice and qualified save for header and window-menu presentation. */
export function useAgentInterestChoice(
  connectionId: string,
  pane?: Pane,
): InterestChoice | null {
  const interest = useAgentInterest();
  if (!pane?.agent || !pane.terminal_id) return null;
  const terminalId = pane.terminal_id;
  return {
    current: interest.interestOf(connectionId, terminalId),
    quiet: interest.anyFocused,
    onInterest: async (next) => {
      const error = await setAgentInterest(connectionId, terminalId, next);
      if (error)
        store.notify({
          kind: "error",
          message: "Agent interest could not be saved",
          detail: error,
        });
    },
  };
}

/** Shared by Spaces and World Inspectors, with the same saved choice. */
export function AgentInterestButton({
  connectionId,
  pane,
}: {
  connectionId: string;
  pane?: Pane;
}) {
  const choice = useAgentInterestChoice(connectionId, pane);
  return choice ? <InterestButton {...choice} /> : null;
}
