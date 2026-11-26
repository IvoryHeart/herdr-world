import type { BinStop } from "../../../../shared/bin";
import { aimAtBinTarget } from "../bin/binDrop";
import { putAgentInBin } from "../bin/WorldBin";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import type { WorldObject } from "../worldObject";
import type { TownInteractionPorts } from "./scene/townInteraction";
import { townBinStopOf, type TownBusRoute } from "./townBus";
import type { TownLayout } from "./townLayout";
import type { TownRoomActions } from "./townRoomActions";

/**
 * Town's drags over the bin: whether a carry at canvas point `at` (in
 * `host`) is over the bin chip or a bus stop, which it marks, and the drop.
 * Dropped on a stop, the stop goes to World as a building corner
 * (townBinStopOf), so the agent waits there.
 */
export function townBinDropPorts(
  host: HTMLElement,
  current: () => {
    layout: TownLayout;
    busRoute: TownBusRoute;
    roomActions: Pick<TownRoomActions, "onBinDrop">;
  },
): Pick<TownInteractionPorts, "binAt" | "bin"> {
  return {
    binAt: (at) => {
      if (!at || !current().roomActions.onBinDrop) {
        aimAtBinTarget(null);
        return null;
      }
      const rect = host.getBoundingClientRect();
      const target = aimAtBinTarget({
        x: rect.left + at.x,
        y: rect.top + at.y,
      });
      return target ? { stop: target.getAttribute("data-stop") } : null;
    },
    bin: (drag, stop) => {
      const { layout, busRoute, roomActions } = current();
      if (drag.kind === "room") return;
      roomActions.onBinDrop?.(
        drag.kind,
        drag.key,
        stop ? townBinStopOf(busRoute, layout, stop) : null,
      );
    },
  };
}

/**
 * An agent, or every agent at a desk, dropped on the bin or a bus stop in
 * Town: each live, actionable agent is put in the bin (a herdr-core one
 * after its children are confirmed). Dropped on a stop (`stop`), they wait
 * there; on the bin, each at the stop nearest its room.
 */
export function putTownDropInBin(
  office: Pick<HerdrOfficeProjection, "rooms" | "roster">,
  world: Pick<WorldObject, "nodeById" | "spaces">,
  kind: "agent" | "desk",
  key: string,
  stop: BinStop | null = null,
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
    if (
      node?.kind === "agent" &&
      !node.stale &&
      (node.actionable || node.coreControl)
    )
      void putAgentInBin(node, "town", world, stop);
  }
}
