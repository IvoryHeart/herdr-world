import type { Tab, Workspace } from "../types";
import {
  defaultFloatingTerminalGeometry,
  resizeMinimumForGeometry,
  SPACES_TAB_WINDOW_MIN_SIZE,
  TILED_TERMINAL_MIN_SIZE,
  type FloatingTerminalGeometry,
} from "./floatingTerminalGeometry";
import { resolveTerminalWindowArrangement } from "./terminalWindowArrangement";
import type { TerminalWindowArrangementScope } from "./terminalWindowArrangementState";

export const SPACES_WINDOW_MIN_WIDTH = SPACES_TAB_WINDOW_MIN_SIZE.width;
export const SPACES_WINDOW_MIN_HEIGHT = SPACES_TAB_WINDOW_MIN_SIZE.height;

type Bounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

/** Removes only an Inspector that actually overlays the terminal layer. */
export function availableSpacesWindowStage(
  layerSize: { width: number; height: number },
  layerBounds: Bounds,
  inspectorBounds: Bounds | null,
  dock: "right" | "bottom",
) {
  if (
    layerBounds.width <= 0 ||
    layerBounds.height <= 0 ||
    !inspectorBounds ||
    inspectorBounds.left >= layerBounds.right ||
    inspectorBounds.right <= layerBounds.left ||
    inspectorBounds.top >= layerBounds.bottom ||
    inspectorBounds.bottom <= layerBounds.top
  ) {
    return layerSize;
  }
  return dock === "right"
    ? {
        width: clamp(
          (inspectorBounds.left - layerBounds.left) *
            (layerSize.width / layerBounds.width),
          0,
          layerSize.width,
        ),
        height: layerSize.height,
      }
    : {
        width: layerSize.width,
        height: clamp(
          (inspectorBounds.top - layerBounds.top) *
            (layerSize.height / layerBounds.height),
          0,
          layerSize.height,
        ),
      };
}

export type SpacesTabWindowContext = {
  leaseKey: string;
  scopeKey: string;
  workspaceId: string;
  activeTabId: string;
  tabs: Tab[];
};

export function spacesTabWindowContext(snapshot: {
  activeConnectionId: string;
  serverRuntimeGeneration: number | null;
  workspaces: readonly Workspace[];
  tabs: readonly Tab[];
}): SpacesTabWindowContext | null {
  const workspace = snapshot.workspaces.find((candidate) => candidate.focused);
  if (
    !snapshot.activeConnectionId ||
    snapshot.serverRuntimeGeneration === null ||
    !workspace
  ) {
    return null;
  }
  const tabs = snapshot.tabs.filter(
    (tab) => tab.workspace_id === workspace.workspace_id,
  );
  const activeTabId =
    tabs.find((tab) => tab.tab_id === workspace.active_tab_id)?.tab_id ??
    tabs.find((tab) => tab.focused)?.tab_id ??
    tabs[0]?.tab_id;
  if (!activeTabId) return null;
  return {
    leaseKey: JSON.stringify([
      snapshot.activeConnectionId,
      snapshot.serverRuntimeGeneration,
    ]),
    scopeKey: `spaces:${workspace.workspace_id}`,
    workspaceId: workspace.workspace_id,
    activeTabId,
    tabs,
  };
}

/** Back-to-front order with the active tab raised without moving any geometry. */
export function orderedSpacesTabs(
  tabs: readonly Tab[],
  raisedIds: readonly string[],
  activeTabId: string,
): Tab[] {
  const rank = new Map(raisedIds.map((id, index) => [id, index]));
  return tabs
    .map((tab, index) => ({ tab, index }))
    .sort((left, right) => {
      if (left.tab.tab_id === right.tab.tab_id) return 0;
      if (left.tab.tab_id === activeTabId) return 1;
      if (right.tab.tab_id === activeTabId) return -1;
      return (
        (rank.get(left.tab.tab_id) ?? -1) -
          (rank.get(right.tab.tab_id) ?? -1) || left.index - right.index
      );
    })
    .map(({ tab }) => tab);
}

export function spacesTabWindowEntries(input: {
  scope: TerminalWindowArrangementScope<"native-single" | "floating"> | null;
  tabs: readonly Tab[];
  activeTabId: string;
  raisedIds: readonly string[];
  freeGeometry: Readonly<Record<string, FloatingTerminalGeometry>>;
  stage: { width: number; height: number };
  compact: boolean;
}): { tab: Tab; geometry: FloatingTerminalGeometry; zIndex: number }[] {
  const { scope, stage } = input;
  if (
    input.compact ||
    !scope?.preset ||
    scope.preset === "single" ||
    stage.width < SPACES_WINDOW_MIN_WIDTH + 16 ||
    stage.height < TILED_TERMINAL_MIN_SIZE.height + 16
  ) {
    return [];
  }
  const openIds = new Set(input.tabs.map((tab) => tab.tab_id));
  const participants = scope.placements.filter(({ id }) => openIds.has(id));
  let arranged = new Map(
    participants.map(({ id, geometry }) => [id, geometry]),
  );
  if (
    participants.length >= 2 &&
    participants.some(
      ({ geometry }) =>
        geometry.left < 0 ||
        geometry.top < 0 ||
        geometry.left + geometry.width > stage.width ||
        geometry.top + geometry.height > stage.height,
    )
  ) {
    const resized = resolveTerminalWindowArrangement(
      scope.preset,
      { left: 0, top: 0, ...stage },
      participants.map(({ id, geometry }) => ({
        id,
        minWidth: SPACES_WINDOW_MIN_WIDTH,
        minHeight: SPACES_WINDOW_MIN_HEIGHT,
        titleHeight: 32,
        geometry,
      })),
      input.activeTabId,
    );
    if (!resized.available) return [];
    arranged = new Map(
      resized.placements.map(({ id, geometry }) => [id, geometry]),
    );
  }
  return orderedSpacesTabs(input.tabs, input.raisedIds, input.activeTabId).map(
    (tab, zIndex) => {
      const geometry =
        arranged.get(tab.tab_id) ??
        input.freeGeometry[tab.tab_id] ??
        defaultFloatingTerminalGeometry(zIndex, stage);
      return {
        tab,
        geometry: clampSpacesTabWindowGeometry(geometry, stage),
        zIndex: zIndex + 1,
      };
    },
  );
}

/** Keep the whole Spaces window inside its measured stage without adding a tile margin. */
export function clampSpacesTabWindowGeometry(
  geometry: FloatingTerminalGeometry,
  stage: { width: number; height: number },
): FloatingTerminalGeometry {
  const minimum = resizeMinimumForGeometry(
    geometry,
    SPACES_TAB_WINDOW_MIN_SIZE,
  );
  const width = clamp(
    geometry.width,
    Math.min(minimum.width, stage.width),
    stage.width,
  );
  const height = clamp(
    geometry.height,
    Math.min(minimum.height, stage.height),
    stage.height,
  );
  return {
    left: clamp(geometry.left, 0, stage.width - width),
    top: clamp(geometry.top, 0, stage.height - height),
    width,
    height,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(Math.max(min, max), value));
}
