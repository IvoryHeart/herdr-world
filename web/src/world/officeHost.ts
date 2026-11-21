import type { ConnectionLifecycleState } from "../api";
import type { WorldHostState } from "./worldObject";

export type OfficeHost = {
  key: string;
  connectionId: string;
  /**
   * Town only, display: the host whose building this runtime's rooms join
   * (one building per machine, town/townBuildings.ts).
   */
  buildingKey?: string;
  displayLabel: string;
  accessibleLabel?: string;
  displayOrder: number;
  connectionState: WorldHostState;
  runtimeState?: ConnectionLifecycleState;
  observed: boolean;
  stale: boolean;
  compatibleWithWorld: boolean;
  compatibleWithSpaces: boolean;
  selected: boolean;
  deterministicSkin: { themeIndex: number; badge: string };
};
