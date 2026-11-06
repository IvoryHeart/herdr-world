import { useMemo } from "react";
import { useWorldBin } from "../bin/binStore";
import type { TownModel } from "./townModel";
import type { TownLayout } from "./townLayout";
import {
  townBusRoute,
  nearestTownStop,
  type TownTransit,
  type TownBusStop,
} from "./townBus";

export function useTownTransit(
  model: TownModel,
  layout: TownLayout,
): TownTransit {
  const bin = useWorldBin();
  const route = useMemo(() => townBusRoute(layout), [layout]);
  return useMemo<TownTransit>(() => {
    const waiting = new Map<string, TownBusStop>();
    const riders = new Set<string>();
    const departed = new Set<string>();
    const entries = [...bin.entries, ...(bin.closing_entries ?? [])];
    const stops = new Map<string, TownBusStop | null>();
    for (const agent of model.agents.values()) {
      const entry = entries.find(
        (entry) =>
          entry.connection_id === agent.currentPaneRef.connectionId &&
          entry.connection_generation === agent.currentPaneRef.generation &&
          entry.pane_id === agent.currentPaneRef.nativeId &&
          entry.terminal_id === agent.currentTerminalRef.nativeId,
      );
      if (!entry) continue;
      const building = layout.buildings.find(
        (building) => building.hostKey === agent.hostKey,
      );
      if (!building) continue;
      if (!stops.has(building.hostKey))
        stops.set(
          building.hostKey,
          nearestTownStop(layout, route, {
            x: building.entryX,
            y: building.y - 1,
          }),
        );
      const stop = stops.get(building.hostKey);
      if (stop) waiting.set(agent.key, stop);
      if (entry.boarded) riders.add(agent.key);
      if (bin.closing.includes(entry.id)) departed.add(agent.key);
    }
    return {
      waiting,
      riders,
      departed,
      route,
      bus: bin.bus,
      readAt: bin.readAt,
    };
  }, [bin, model, layout, route]);
}
