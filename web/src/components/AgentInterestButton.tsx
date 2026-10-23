import type { Pane } from "../types";
import { store } from "../store";
import { setAgentInterest, useAgentInterest } from "../world/useAgentInterest";
import { InterestButton } from "./InterestButton";

/** Shared by the Spaces and World Inspectors, with the same saved choice. */
export function AgentInterestButton({
  connectionId,
  pane,
}: {
  connectionId: string;
  pane?: Pane;
}) {
  const interest = useAgentInterest();
  if (!pane?.agent || !pane.terminal_id) return null;
  const terminalId = pane.terminal_id;
  return (
    <InterestButton
      current={interest.interestOf(connectionId, terminalId)}
      quiet={interest.anyFocused}
      override={interest.overrideOf(connectionId, terminalId)}
      description={interest.descriptionOf(connectionId, terminalId)}
      onDefault={async () => {
        const error = await setAgentInterest(connectionId, terminalId, null);
        if (error)
          store.notify({
            kind: "error",
            message: "Agent interest could not be saved",
            detail: error,
          });
      }}
      onInterest={async (next) => {
        const error = await setAgentInterest(connectionId, terminalId, next);
        if (error)
          store.notify({
            kind: "error",
            message: "Agent interest could not be saved",
            detail: error,
          });
      }}
    />
  );
}
