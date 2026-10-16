export type OfficeRoomAlignment = "left" | "center" | "right";
export type OfficeLongTitleMode = "expand" | "compact";
export type OfficeInspectorPresentation = "docked" | "floating";

export type OfficeScrollPosition = { left: number; top: number };

export type OfficePreferences = {
  compactScroll?: OfficeScrollPosition;
  desktopScroll?: OfficeScrollPosition;
  roomAlignment: OfficeRoomAlignment;
  longTitleMode: OfficeLongTitleMode;
  inspectorPresentation: OfficeInspectorPresentation;
  scrollLeft: number;
  scrollTop: number;
};

export const DEFAULT_OFFICE_PREFERENCES: OfficePreferences = Object.freeze({
  roomAlignment: "left",
  longTitleMode: "expand",
  inspectorPresentation: "floating",
  scrollLeft: 0,
  scrollTop: 0,
});

export const OFFICE_PREFERENCES_KEY = "officePreferences:v1";
export const WORLD_OFFICE_PREFERENCES_CHANGED_EVENT =
  "herdr-world:office-preferences-changed";
const MAX_OFFICE_SCROLL = 1_000_000;

type OfficePreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function readOfficePreferences(
  storage: OfficePreferenceStorage,
): OfficePreferences {
  try {
    const raw = storage.getItem(OFFICE_PREFERENCES_KEY);
    if (!raw) return { ...DEFAULT_OFFICE_PREFERENCES };
    const value = JSON.parse(raw) as Record<string, unknown>;
    return {
      roomAlignment: isRoomAlignment(value.roomAlignment)
        ? value.roomAlignment
        : DEFAULT_OFFICE_PREFERENCES.roomAlignment,
      longTitleMode: isLongTitleMode(value.longTitleMode)
        ? value.longTitleMode
        : DEFAULT_OFFICE_PREFERENCES.longTitleMode,
      inspectorPresentation: isInspectorPresentation(
        value.inspectorPresentation,
      )
        ? value.inspectorPresentation
        : DEFAULT_OFFICE_PREFERENCES.inspectorPresentation,
      scrollLeft: boundedScroll(value.scrollLeft),
      scrollTop: boundedScroll(value.scrollTop),
      ...scenePositions(value),
    };
  } catch {
    return { ...DEFAULT_OFFICE_PREFERENCES };
  }
}

export function writeOfficePreferences(
  storage: OfficePreferenceStorage,
  preferences: OfficePreferences,
) {
  const admitted: OfficePreferences = {
    roomAlignment: isRoomAlignment(preferences.roomAlignment)
      ? preferences.roomAlignment
      : DEFAULT_OFFICE_PREFERENCES.roomAlignment,
    longTitleMode: isLongTitleMode(preferences.longTitleMode)
      ? preferences.longTitleMode
      : DEFAULT_OFFICE_PREFERENCES.longTitleMode,
    inspectorPresentation: isInspectorPresentation(
      preferences.inspectorPresentation,
    )
      ? preferences.inspectorPresentation
      : DEFAULT_OFFICE_PREFERENCES.inspectorPresentation,
    scrollLeft: boundedScroll(preferences.scrollLeft),
    scrollTop: boundedScroll(preferences.scrollTop),
    ...scenePositions(preferences),
  };
  try {
    storage.setItem(OFFICE_PREFERENCES_KEY, JSON.stringify(admitted));
  } catch {
    // Presentation preferences must never prevent Office from rendering.
  }
  return admitted;
}

function isRoomAlignment(value: unknown): value is OfficeRoomAlignment {
  return value === "left" || value === "center" || value === "right";
}

function isLongTitleMode(value: unknown): value is OfficeLongTitleMode {
  return value === "expand" || value === "compact";
}

function isInspectorPresentation(
  value: unknown,
): value is OfficeInspectorPresentation {
  return value === "docked" || value === "floating";
}

function boundedScroll(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(MAX_OFFICE_SCROLL, Math.max(0, Math.round(value)))
    : 0;
}

function scenePositions(value: {
  compactScroll?: unknown;
  desktopScroll?: unknown;
}) {
  const result: {
    compactScroll?: OfficeScrollPosition;
    desktopScroll?: OfficeScrollPosition;
  } = {};
  for (const key of ["compactScroll", "desktopScroll"] as const) {
    const position = value[key];
    if (!position || typeof position !== "object" || Array.isArray(position))
      continue;
    const raw = position as Record<string, unknown>;
    const read = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value)
        ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(value)))
        : 0;
    result[key] = { left: read(raw.left), top: read(raw.top) };
  }
  return result;
}
