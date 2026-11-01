import { useState } from "react";
import type { OfficeAgent } from "../officeProjectionTypes";
import { townBusSender } from "../town/useTownBus";

/**
 * The peek's way to the bin, for people who don't drag: the agent walks to
 * Town's bus stop and waits for the bus, exactly as if dropped there.
 */
export function TownBusStopAction({ agent }: { agent: OfficeAgent }) {
  const [sent, setSent] = useState(false);
  if (!townBusSender.send || agent.stale || !agent.canOpenInSpaces) return null;
  return (
    <button
      type="button"
      disabled={sent}
      onClick={() => {
        setSent(true);
        void townBusSender
          .send?.(agent.key)
          .then((result) => setSent(result === "moved"));
      }}
    >
      {sent ? "Waiting for the bus" : "Send to the bus stop"}
    </button>
  );
}
