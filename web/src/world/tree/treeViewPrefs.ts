export const TREE_VIEW_PREFS_KEY = "herdr.world.tree-view.v1";

const MAX_SAVED_IDS = 2304;
const MAX_ID_LENGTH = 512;
const MAX_COORDINATE = 1_000_000;

export type TreeCamera = { x: number; y: number; zoom: number };
export type TreeViewPrefs = { camera: TreeCamera; collapsedIds: string[] };

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
  return typeof value === "number" && Number.isFinite(value) && value >= 0.4 && value <= 2.5;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
