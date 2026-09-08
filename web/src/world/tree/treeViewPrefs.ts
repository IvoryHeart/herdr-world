export const TREE_VIEW_PREFS_KEY = "herdr.world.tree-view.v1";
export const TREE_MIN_ZOOM = 0.4;
export const TREE_MAX_ZOOM = 2.5;
export const TREE_CAMERA_PADDING = 16;

const MAX_SAVED_IDS = 2304;
const MAX_ID_LENGTH = 512;
const MAX_COORDINATE = 1_000_000;

export type TreeCamera = { x: number; y: number; zoom: number };
export type TreeViewPrefs = { camera: TreeCamera; collapsedIds: string[] };
export type TreeCameraGeometry = {
  viewportWidth: number;
  viewportHeight: number;
  mapWidth: number;
  mapHeight: number;
};

export const DEFAULT_TREE_VIEW_PREFS: TreeViewPrefs = Object.freeze({
  camera: Object.freeze({ x: 0, y: 0, zoom: 1 }),
  collapsedIds: Object.freeze([]) as unknown as string[],
});

export function readTreeViewPrefs(): TreeViewPrefs {
  try {
    const raw = window.localStorage.getItem(TREE_VIEW_PREFS_KEY);
    return raw ? parseTreeViewPrefs(JSON.parse(raw)) : freshDefaults();
  } catch {
    return freshDefaults();
  }
}

export function writeTreeViewPrefs(prefs: TreeViewPrefs) {
  try {
    window.localStorage.setItem(TREE_VIEW_PREFS_KEY, JSON.stringify(parseTreeViewPrefs(prefs)));
  } catch {
    // Storage is optional in private or locked-down browser contexts.
  }
}

export function parseTreeViewPrefs(value: unknown): TreeViewPrefs {
  if (!isRecord(value)) return freshDefaults();
  const cameraValue = isRecord(value.camera) ? value.camera : {};
  const camera = {
    x: validCoordinate(cameraValue.x) ? cameraValue.x : 0,
    y: validCoordinate(cameraValue.y) ? cameraValue.y : 0,
    zoom: validZoom(cameraValue.zoom) ? cameraValue.zoom : 1,
  };
  const collapsedIds = Array.isArray(value.collapsedIds)
    ? [...new Set(value.collapsedIds.filter(validId))].slice(0, MAX_SAVED_IDS)
    : [];
  return { camera, collapsedIds };
}

export function boundTreeCamera(camera: TreeCamera, geometry: TreeCameraGeometry): TreeCamera {
  const zoom = clampTreeZoom(camera.zoom);
  return {
    x: boundAxis(camera.x, geometry.viewportWidth, geometry.mapWidth, zoom),
    y: boundAxis(camera.y, geometry.viewportHeight, geometry.mapHeight, zoom),
    zoom,
  };
}

export function fitTreeCamera(geometry: TreeCameraGeometry): TreeCamera {
  const availableWidth = Math.max(geometry.viewportWidth - TREE_CAMERA_PADDING * 2, 1);
  const availableHeight = Math.max(geometry.viewportHeight - TREE_CAMERA_PADDING * 2, 1);
  const zoom = clampTreeZoom(Math.min(
    availableWidth / Math.max(geometry.mapWidth, 1),
    availableHeight / Math.max(geometry.mapHeight, 1),
    1,
  ));
  return boundTreeCamera({ x: TREE_CAMERA_PADDING, y: TREE_CAMERA_PADDING, zoom }, geometry);
}

export function clampTreeZoom(value: number) {
  return Math.max(TREE_MIN_ZOOM, Math.min(TREE_MAX_ZOOM, value));
}

function freshDefaults(): TreeViewPrefs {
  return { camera: { x: 0, y: 0, zoom: 1 }, collapsedIds: [] };
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function validCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;
}

function validZoom(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) &&
    value >= TREE_MIN_ZOOM && value <= TREE_MAX_ZOOM;
}

function boundAxis(value: number, viewportSize: number, mapSize: number, zoom: number) {
  const safeViewport = finitePositive(viewportSize);
  const scaledMap = finitePositive(mapSize) * zoom;
  if (scaledMap <= Math.max(safeViewport - TREE_CAMERA_PADDING * 2, 0)) {
    return (safeViewport - scaledMap) / 2;
  }
  const minimum = safeViewport - scaledMap - TREE_CAMERA_PADDING;
  return Math.max(minimum, Math.min(TREE_CAMERA_PADDING, Number.isFinite(value) ? value : 0));
}

function finitePositive(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
