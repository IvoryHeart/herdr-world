import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import type { WorldObject } from "../worldObject";
import { putInBin } from "../bin/binStore";
import type { TownMoveResult } from "./townMoves";

/** Resolve the carried agent against the current World, retaining its owner fences. */
export async function binTownAgent(
  world: WorldObject,
  projection: HerdrOfficeProjection,
  key: string,
): Promise<TownMoveResult> {
  const agent = projection.roster.find((item) => item.agent.key === key)?.agent;
  const leaf = agent && world.nodeById.get(agent.nodeId);
  return leaf?.kind === "agent" && (await putInBin(leaf, world, "town"))
    ? "moved"
    : "returned";
}
