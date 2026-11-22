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
  /**
   * Town only, display: the connection its building's colour is read under,
   * when Town shows it in place of another view of the same Herdr endpoint
   * (townBuildings.ts). Never identity: actions read `connectionId`.
   */
  placeConnectionId?: string;
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
