import { putAgentInBin } from "../bin/WorldBin";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import type { WorldObject } from "../worldObject";

/**
 * An agent, or every agent at a desk, dropped on the bin or a bus stop in
 * Town: each live, actionable agent is put in the bin.
 */
export function putTownDropInBin(
  office: Pick<HerdrOfficeProjection, "rooms" | "roster">,
  world: Pick<WorldObject, "nodeById" | "spaces">,
  kind: "agent" | "desk",
  key: string,
) {
  const keys =
    kind === "agent"
      ? [key]
      : (office.rooms
          .flatMap((room) => room.desks)
          .find((desk) => desk.key === key)
          ?.paneDevices.flatMap((device) =>
            device.agentKey ? [device.agentKey] : [],
          ) ?? []);
  for (const agentKey of keys) {
    const agent = office.roster.find(
      (entry) => entry.agent.key === agentKey,
    )?.agent;
    const node = agent && world.nodeById.get(agent.nodeId);
    if (node?.kind === "agent" && !node.stale && node.actionable)
      void putAgentInBin(node, "town", world);
  }
}
