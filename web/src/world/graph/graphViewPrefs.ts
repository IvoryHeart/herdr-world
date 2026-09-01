export const GRAPH_VIEW_PREFS_KEY = "herdr.world.graph-view.v1";

const MAX_SAVED_NODE_IDS = 2304;
const MAX_NODE_ID_LENGTH = 512;
const MAX_COORDINATE = 1_000_000;

export type GraphCamera = {
  x: number;
  y: number;
  zoom: number;
};

export type SavedGraphPosition = {
  x: number;
  y: number;
  pinned: boolean;
};

export type GraphViewPrefs = {
  camera: GraphCamera;
  collapsedIds: string[];
  positions: Record<string, SavedGraphPosition>;
};

export type InitialGraphViewPrefs = {
  prefs: GraphViewPrefs;
  fitOnMount: boolean;
};

export const DEFAULT_GRAPH_VIEW_PREFS: GraphViewPrefs = Object.freeze({
  camera: Object.freeze({ x: 0, y: 0, zoom: 1 }),
  collapsedIds: Object.freeze([]) as unknown as string[],
  positions: Object.freeze({}),
});

export function readGraphViewPrefs(): GraphViewPrefs {
  return readInitialGraphViewPrefs().prefs;
}

export function readInitialGraphViewPrefs(): InitialGraphViewPrefs {
  try {
    const raw = window.localStorage.getItem(GRAPH_VIEW_PREFS_KEY);
    if (!raw) return { prefs: freshDefaults(), fitOnMount: true };
    const parsed = JSON.parse(raw);
    return {
      prefs: parseGraphViewPrefs(parsed),
      fitOnMount: !hasSavedCamera(parsed),
    };
  } catch {
    return { prefs: freshDefaults(), fitOnMount: true };
  }
}

export function writeGraphViewPrefs(prefs: GraphViewPrefs) {
  try {
    window.localStorage.setItem(GRAPH_VIEW_PREFS_KEY, JSON.stringify(parseGraphViewPrefs(prefs)));
  } catch {
    // Storage is optional in private or locked-down browser contexts.
  }
}

export function parseGraphViewPrefs(value: unknown): GraphViewPrefs {
  if (!isRecord(value)) {
    return freshDefaults();
  }
  const cameraValue = isRecord(value.camera) ? value.camera : {};
  const camera = {
    x: validCoordinate(cameraValue.x) ? cameraValue.x : 0,
    y: validCoordinate(cameraValue.y) ? cameraValue.y : 0,
    zoom: validZoom(cameraValue.zoom) ? cameraValue.zoom : 1,
  };
  const collapsedIds = Array.isArray(value.collapsedIds)
    ? [...new Set(value.collapsedIds.filter(validNodeId))].slice(0, MAX_SAVED_NODE_IDS)
    : [];
  const positions: Record<string, SavedGraphPosition> = {};
  if (isRecord(value.positions)) {
    for (const [id, position] of Object.entries(value.positions).slice(0, MAX_SAVED_NODE_IDS)) {
      if (!validNodeId(id) || !isRecord(position)) {
        continue;
      }
      if (
        validCoordinate(position.x) &&
        validCoordinate(position.y) &&
        typeof position.pinned === "boolean"
      ) {
        positions[id] = { x: position.x, y: position.y, pinned: position.pinned };
      }
    }
  }
  return { camera, collapsedIds, positions };
}

function freshDefaults(): GraphViewPrefs {
  return { camera: { x: 0, y: 0, zoom: 1 }, collapsedIds: [], positions: {} };
}

function validNodeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_NODE_ID_LENGTH;
}

function validCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;
}

function validZoom(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0.25 && value <= 3;
}

function hasSavedCamera(value: unknown) {
  if (!isRecord(value) || !isRecord(value.camera)) return false;
  if (!(validCoordinate(value.camera.x) &&
    validCoordinate(value.camera.y) &&
    validZoom(value.camera.zoom))) return false;
  // Earlier builds wrote the untouched fallback camera on first visit. Treat
  // that legacy placeholder as fresh so the new fit-first default takes over.
  return value.camera.x !== DEFAULT_GRAPH_VIEW_PREFS.camera.x ||
    value.camera.y !== DEFAULT_GRAPH_VIEW_PREFS.camera.y ||
    value.camera.zoom !== DEFAULT_GRAPH_VIEW_PREFS.camera.zoom;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
