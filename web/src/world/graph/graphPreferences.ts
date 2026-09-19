export const GRAPH_PREFERENCES_KEY = "worldGraphPreferences:v1";

const MAX_SAVED_NODE_IDS = 2_304;
const MAX_NODE_ID_LENGTH = 1_024;
const MAX_COORDINATE = 1_000_000;

type GraphPreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export type GraphCamera = { x: number; y: number; zoom: number };
export type GraphCameraMode = "fit" | "manual";
export type SavedGraphPosition = {
  x: number;
  y: number;
  pinned: boolean;
};
export type GraphPreferences = {
  camera: GraphCamera;
  cameraMode: GraphCameraMode;
  collapsedIds: string[];
  positions: Record<string, SavedGraphPosition>;
};

export function readGraphPreferences(storage: GraphPreferenceStorage): {
  prefs: GraphPreferences;
  fitOnMount: boolean;
} {
  try {
    const raw = storage.getItem(GRAPH_PREFERENCES_KEY);
    const prefs = raw ? parseGraphPreferences(JSON.parse(raw)) : defaults();
    return { prefs, fitOnMount: prefs.cameraMode === "fit" };
  } catch {
    return { prefs: defaults(), fitOnMount: true };
  }
}

export function writeGraphPreferences(
  storage: GraphPreferenceStorage,
  preferences: GraphPreferences,
) {
  try {
    storage.setItem(
      GRAPH_PREFERENCES_KEY,
      JSON.stringify(parseGraphPreferences(preferences)),
    );
  } catch {
    // Graph view state is optional in restricted browser contexts.
  }
}

export function parseGraphPreferences(value: unknown): GraphPreferences {
  if (!isRecord(value)) return defaults();
  const rawCamera = isRecord(value.camera) ? value.camera : {};
  const validCamera =
    validCoordinate(rawCamera.x) &&
    validCoordinate(rawCamera.y) &&
    validZoom(rawCamera.zoom);
  const camera = validCamera
    ? {
        x: rawCamera.x as number,
        y: rawCamera.y as number,
        zoom: rawCamera.zoom as number,
      }
    : { x: 0, y: 0, zoom: 1 };
  const cameraMode =
    validCamera && value.cameraMode === "manual" ? "manual" : "fit";
  const collapsedIds = Array.isArray(value.collapsedIds)
    ? [...new Set(value.collapsedIds.filter(validNodeId))].slice(
        0,
        MAX_SAVED_NODE_IDS,
      )
    : [];
  const positions: Record<string, SavedGraphPosition> = {};
  if (isRecord(value.positions)) {
    for (const [id, position] of Object.entries(value.positions).slice(
      0,
      MAX_SAVED_NODE_IDS,
    )) {
      if (!validNodeId(id) || !isRecord(position)) continue;
      if (
        validCoordinate(position.x) &&
        validCoordinate(position.y) &&
        typeof position.pinned === "boolean"
      ) {
        positions[id] = {
          x: position.x,
          y: position.y,
          pinned: position.pinned,
        };
      }
    }
  }
  return { camera, cameraMode, collapsedIds, positions };
}

function defaults(): GraphPreferences {
  return {
    camera: { x: 0, y: 0, zoom: 1 },
    cameraMode: "fit",
    collapsedIds: [],
    positions: {},
  };
}

function validNodeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_NODE_ID_LENGTH
  );
}

function validCoordinate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= MAX_COORDINATE
  );
}

function validZoom(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0.25 &&
    value <= 3
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
