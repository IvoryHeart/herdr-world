import type { ConnectionLifecycleState } from "../api";
import type { WorldHostState } from "./worldObject";

export type OfficeHost = {
  key: string;
  connectionId: string;
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
